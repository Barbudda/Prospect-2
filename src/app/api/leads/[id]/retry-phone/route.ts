// Re-runs the phone hunter for a lead using everything we already know:
// stored name, address, postal code, GPS (from visual reconstruction),
// and any exterior signals (mailbox surnames, property names) mined earlier.
//
// If a high-validation candidate is found, lead.phone is updated and the
// best number is returned alongside the full ranked candidate list.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { huntPhone, type PhoneResult } from "@/lib/engines/phone-hunter";
import type { ExteriorSignals } from "@/lib/engines/exterior-text-miner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface GeoSignalsBlob {
  detected_location?: {
    latitude?: number;
    longitude?: number;
    address?: string;
    neighborhood?: string;
    confidence?: number;
  };
  exterior_signals?: ExteriorSignals;
  pipeline_steps?: Record<string, string>;
}

function parseGeoSignals(raw: unknown): GeoSignalsBlob {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as GeoSignalsBlob;
    } catch {
      return {};
    }
  }
  return raw as GeoSignalsBlob;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: lead, error } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const geo = parseGeoSignals(lead.geo_signals);
    const detectedLocation = geo.detected_location;
    const exteriorSignals = geo.exterior_signals;
    const postalCode = lead.address?.match(/\b(\d{5})\b/)?.[1];

    // operator_name must be a real entity name, NOT a listing title.
    // For visual-reconstruction leads where no operator was identified,
    // primary_name is the listing title (e.g. "Appartement cocooning") —
    // searching for that returns nothing useful. Skip it when company_name is null.
    const operatorName =
      lead.company_name ??
      (lead.source_type !== "visual_reconstruction" ? lead.primary_name : undefined);

    const phones: PhoneResult[] = await huntPhone({
      operator_name: operatorName,
      host_name: lead.person_name ?? undefined,
      address: lead.address ?? detectedLocation?.address,
      city: lead.city,
      country: lead.country,
      has_website: Boolean(lead.website_url),
      latitude: detectedLocation?.latitude,
      longitude: detectedLocation?.longitude,
      postal_code: postalCode,
      exterior_signals: exteriorSignals,
    });

    const service = createServiceClient();

    // Update lead.phone if we found at least one validated candidate
    let updated = false;
    const top = phones[0];
    const acceptableScore = (top?.validation_score ?? 0) >= 20;

    if (top && acceptableScore && !lead.phone) {
      const { error: updateErr } = await service
        .from("leads")
        .update({
          phone: top.number,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("user_id", user.id);
      if (!updateErr) updated = true;
    }

    // Log the retry attempt (best-effort — schema may differ between envs)
    await service
      .from("lead_enrichment_events")
      .insert({
        lead_id: id,
        provider: "phone_hunter_retry",
        status: phones.length > 0 ? "success" : "no_results",
        error_message: phones.length > 0 ? null : "No candidate phones found",
      })
      .then(() => undefined)
      .then(undefined, () => undefined);

    return NextResponse.json({
      phones,
      updated,
      best_phone: updated ? top.number : null,
      best_validation_score: top?.validation_score ?? 0,
      info: {
        used_address: lead.address ?? detectedLocation?.address ?? null,
        used_postal: postalCode ?? null,
        used_gps: detectedLocation?.latitude
          ? { lat: detectedLocation.latitude, lon: detectedLocation.longitude }
          : null,
        used_exterior_signals: exteriorSignals
          ? {
              surnames: exteriorSignals.surnames?.length ?? 0,
              property_names: exteriorSignals.property_names?.length ?? 0,
              permit: Boolean(exteriorSignals.permit_info),
            }
          : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/[id]/retry-phone]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

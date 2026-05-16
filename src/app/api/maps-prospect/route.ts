// Maps Prospect endpoint — runs the Google Places / cadastre discovery engine
// for a city, validates phones, and saves the leads.
//
// Body: { city: string, country?: string, max_leads?: number, enrich_cadastre?: boolean }

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runMapsProspect } from "@/lib/engines/maps-prospector";
import { gradeLead } from "@/lib/engines/lead-quality-gate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!process.env.GOOGLE_PLACES_API_KEY)
      return NextResponse.json(
        { error: "GOOGLE_PLACES_API_KEY not configured. Add it in Settings." },
        { status: 503 }
      );

    const body = (await req.json()) as {
      city?: string;
      country?: string;
      max_leads?: number;
      enrich_cadastre?: boolean;
    };

    const { city, country = "France", max_leads = 25, enrich_cadastre = false } = body;

    if (!city || typeof city !== "string" || city.trim().length < 2)
      return NextResponse.json({ error: "city is required" }, { status: 400 });

    const result = await runMapsProspect({
      city: city.trim(),
      country,
      max_leads: Math.min(Math.max(1, max_leads), 50),
      enrich_cadastre,
    });

    if (!result.leads.length)
      return NextResponse.json({
        saved: 0,
        total_found: result.total_found,
        queries_used: result.queries_used,
        skipped_no_contact: result.skipped_no_contact,
        skipped_invalid_phone: result.skipped_invalid_phone,
        leads: [],
        info: "No relevant operators found on Google Maps for this city.",
      });

    // Quality gate — reject press articles, help pages, generic guides etc.
    // before we touch the DB.
    const gated = result.leads.filter((l) => gradeLead(l).keep);
    const droppedByGate = result.leads.length - gated.length;

    // Save leads (skip if same google_maps_url already saved for this user)
    const service = createServiceClient();
    const sourceUrls = gated.map((l) => l.source_url).filter(Boolean);
    const { data: existing } = sourceUrls.length
      ? await service
          .from("leads")
          .select("source_url")
          .eq("user_id", user.id)
          .in("source_url", sourceUrls)
      : { data: [] as Array<{ source_url: string }> };

    const existingUrls = new Set((existing ?? []).map((e) => e.source_url));
    const toInsert = gated
      .filter((l) => !existingUrls.has(l.source_url))
      .map((l) => ({
        user_id: user.id,
        primary_name: l.primary_name,
        company_name: l.company_name ?? null,
        lead_type: l.lead_type,
        city: l.city,
        country: l.country,
        address: l.address ?? null,
        website_url: l.website_url ?? null,
        phone: l.phone ?? null,
        email: l.email ?? null,
        google_maps_url: l.google_maps_url ?? null,
        source_url: l.source_url,
        source_type: l.source_type,
        score: l.score,
        score_label: l.score_label,
        confidence: l.confidence,
        status: "new",
        outreach_status: "not_contacted",
        suggested_angle: l.suggested_angle ?? null,
        quality_summary: l.quality_summary ?? null,
        exclusivity_score: l.exclusivity_score ?? null,
      }));

    let inserted: Array<{ id: string }> = [];
    if (toInsert.length > 0) {
      const { data, error: insertError } = await service
        .from("leads")
        .insert(toInsert)
        .select("id");
      if (insertError) {
        console.error("[maps-prospect] DB insert error:", insertError.message);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      inserted = data ?? [];
    }

    return NextResponse.json({
      saved: inserted.length,
      duplicates_skipped: gated.length - toInsert.length,
      rejected_by_quality_gate: droppedByGate,
      total_found: result.total_found,
      queries_used: result.queries_used,
      skipped_no_contact: result.skipped_no_contact,
      skipped_invalid_phone: result.skipped_invalid_phone,
      leads: toInsert.map((l, i) => ({
        id: inserted[i]?.id,
        primary_name: l.primary_name,
        lead_type: l.lead_type,
        city: l.city,
        address: l.address,
        phone: l.phone,
        website_url: l.website_url,
        google_maps_url: l.google_maps_url,
        score: l.score,
        score_label: l.score_label,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/maps-prospect]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

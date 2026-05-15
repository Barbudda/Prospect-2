// POST /api/partners/discover
// Active partner discovery via Google Places. Saves discovered suppliers
// as partner-tagged leads so the user can approach them with a partnership
// offer (not a sales pitch).
//
// Body: { city, country?, roles?, max_per_role? }

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { discoverPartners } from "@/lib/engines/partner-discovery";

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
        { error: "GOOGLE_PLACES_API_KEY not configured." },
        { status: 503 }
      );

    const body = (await req.json()) as {
      city?: string;
      country?: string;
      roles?: string[];
      max_per_role?: number;
    };
    if (!body.city || body.city.trim().length < 2)
      return NextResponse.json({ error: "city is required" }, { status: 400 });

    const result = await discoverPartners({
      city: body.city.trim(),
      country: body.country ?? "France",
      roles: body.roles,
      max_per_role: Math.min(Math.max(1, body.max_per_role ?? 5), 15),
    });

    if (!result.leads.length)
      return NextResponse.json({
        saved: 0,
        by_role: result.by_role,
        queries_executed: result.queries_executed,
        leads: [],
      });

    // Save (dedupe by source_url)
    const service = createServiceClient();
    const sourceUrls = result.leads.map((l) => l.source_url).filter(Boolean);
    const { data: existing } = await service
      .from("leads")
      .select("source_url")
      .eq("user_id", user.id)
      .in("source_url", sourceUrls);
    const existingUrls = new Set((existing ?? []).map((e) => e.source_url));

    const toInsert = result.leads
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
      const { data, error } = await service.from("leads").insert(toInsert).select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      inserted = data ?? [];
    }

    return NextResponse.json({
      saved: inserted.length,
      duplicates_skipped: result.leads.length - toInsert.length,
      by_role: result.by_role,
      queries_executed: result.queries_executed,
      leads: result.leads.map((l, i) => ({
        id: inserted[i]?.id,
        name: l.primary_name,
        role: l.source_type,
        city: l.city,
        phone: l.phone,
        website_url: l.website_url,
        score: l.score,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/partners/discover]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

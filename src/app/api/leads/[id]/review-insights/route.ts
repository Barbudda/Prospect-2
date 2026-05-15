// GET /api/leads/[id]/review-insights
// Returns hypothesised guest pain points + amenity gaps from text we already
// stored on the lead. Lite version of #9 — no external review data.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scanReviewIntelligence, type LeadForReviewIntel } from "@/lib/engines/review-intelligence";

export const dynamic = "force-dynamic";

export async function GET(
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
      .select("primary_name, company_name, listing_title, quality_summary, lead_type, city, country")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (error || !lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const signals = scanReviewIntelligence(lead as LeadForReviewIntel);
    return NextResponse.json({ count: signals.length, signals });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/leads/[id]/review-insights]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/leads/[id]/weird-signals
// Runs the Weird Signal Scanner against a single lead's stored fields and
// returns the ranked signal list. Pure analysis — no new external calls.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  scanLeadForWeirdSignals,
  severityRank,
  type LeadForSignals,
} from "@/lib/engines/weird-signal-scanner";

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
      .select(
        "primary_name, company_name, city, country, lead_type, website_url, email, phone, instagram_url, facebook_url, linkedin_url, source_type, superhost, review_count, listing_title, reconstructed, reconstruction_confidence, exclusivity_score, score, opportunity_score, has_booking_engine, has_chatbot, has_faq, automation_level, has_owner_acquisition_page, estimated_property_count, geo_signals"
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const signals = scanLeadForWeirdSignals(lead as LeadForSignals).sort(
      (a, b) => severityRank(b) - severityRank(a)
    );

    return NextResponse.json({ count: signals.length, signals });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/leads/[id]/weird-signals]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/weird-signals
// Runs the Weird Signal Scanner across ALL the user's leads and returns the
// portfolio-level opportunity picture: which signals fire most often, top
// leads per signal type, total high-severity counts.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  scanLeadForWeirdSignals,
  type LeadForSignals,
  type WeirdSignal,
} from "@/lib/engines/weird-signal-scanner";

export const dynamic = "force-dynamic";

interface LeadRecord extends LeadForSignals {
  id: string;
}

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: leads, error } = await supabase
      .from("leads")
      .select(
        "id, primary_name, company_name, city, country, lead_type, website_url, email, phone, instagram_url, facebook_url, linkedin_url, source_type, superhost, review_count, listing_title, reconstructed, reconstruction_confidence, exclusivity_score, score, opportunity_score, has_booking_engine, has_chatbot, has_faq, automation_level, has_owner_acquisition_page, estimated_property_count, geo_signals"
      )
      .eq("user_id", user.id)
      .neq("status", "draft")
      .limit(2000);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (leads ?? []) as LeadRecord[];

    // For each lead, scan; collect signals tagged with their lead id.
    interface SignalHit extends WeirdSignal {
      lead_id: string;
      lead_name: string;
      city: string;
      score: number;
    }
    const all: SignalHit[] = [];
    for (const lead of rows) {
      const signals = scanLeadForWeirdSignals(lead);
      for (const s of signals) {
        all.push({
          ...s,
          lead_id: lead.id,
          lead_name: lead.primary_name ?? "",
          city: lead.city ?? "",
          score: lead.score ?? 0,
        });
      }
    }

    // Bucket by signal code → counts + top examples
    const bySignal = new Map<
      string,
      {
        code: string;
        severity: "high" | "medium" | "low";
        description: string;
        outreach_hint: string;
        count: number;
        top_examples: Array<{ lead_id: string; lead_name: string; city: string; score: number }>;
      }
    >();
    for (const hit of all) {
      const existing = bySignal.get(hit.code);
      if (existing) {
        existing.count++;
        if (existing.top_examples.length < 5) {
          existing.top_examples.push({
            lead_id: hit.lead_id,
            lead_name: hit.lead_name,
            city: hit.city,
            score: hit.score,
          });
        }
      } else {
        bySignal.set(hit.code, {
          code: hit.code,
          severity: hit.severity,
          description: hit.description,
          outreach_hint: hit.outreach_hint,
          count: 1,
          top_examples: [
            {
              lead_id: hit.lead_id,
              lead_name: hit.lead_name,
              city: hit.city,
              score: hit.score,
            },
          ],
        });
      }
    }

    const summary = Array.from(bySignal.values()).sort((a, b) => {
      const sevRank = { high: 3, medium: 2, low: 1 } as const;
      const sevDiff = sevRank[b.severity] - sevRank[a.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.count - a.count;
    });

    const highCount = all.filter((s) => s.severity === "high").length;
    const mediumCount = all.filter((s) => s.severity === "medium").length;
    const lowCount = all.filter((s) => s.severity === "low").length;

    return NextResponse.json({
      total_leads_scanned: rows.length,
      total_signals: all.length,
      severity_counts: { high: highCount, medium: mediumCount, low: lowCount },
      signal_types: summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/weird-signals]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

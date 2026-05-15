// GET /api/dashboard
// Aggregates the prioritisation views from the brief (#16):
//   - Best leads by city
//   - Top operators by cluster size
//   - Best multi-property operators
//   - Highest revenue upside (= highest scoring leads with no-website signal)
//   - Top weird-signal codes by frequency
//   - Compliance health (counts of opted_out, unsubscribed, suppressed)
//
// Pure aggregation over existing tables. No new external calls.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectOperatorClusters, type LeadForClustering } from "@/lib/engines/operator-clusterer";
import { scanLeadForWeirdSignals, type LeadForSignals } from "@/lib/engines/weird-signal-scanner";

export const dynamic = "force-dynamic";

interface LeadRow {
  id: string;
  primary_name: string;
  company_name?: string | null;
  city?: string | null;
  country?: string | null;
  lead_type?: string | null;
  email?: string | null;
  phone?: string | null;
  website_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
  score: number;
  score_label?: string | null;
  source_type?: string | null;
  outreach_status?: string | null;
  status?: string | null;
  superhost?: boolean | null;
  review_count?: number | null;
  listing_title?: string | null;
  reconstructed?: boolean | null;
  reconstruction_confidence?: number | null;
  exclusivity_score?: number | null;
  opportunity_score?: number | null;
  has_booking_engine?: boolean | null;
  has_chatbot?: boolean | null;
  has_faq?: boolean | null;
  automation_level?: "low" | "medium" | "high" | null;
  has_owner_acquisition_page?: boolean | null;
  estimated_property_count?: number | null;
  geo_signals?: unknown;
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

    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, primary_name, company_name, city, country, lead_type, email, phone, website_url, instagram_url, facebook_url, linkedin_url, score, score_label, source_type, outreach_status, status, superhost, review_count, listing_title, reconstructed, reconstruction_confidence, exclusivity_score, opportunity_score, has_booking_engine, has_chatbot, has_faq, automation_level, has_owner_acquisition_page, estimated_property_count, geo_signals"
      )
      .eq("user_id", user.id)
      .neq("status", "draft")
      .limit(3000);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    const leads = (data ?? []) as LeadRow[];

    // ── Best leads by city ───────────────────────────────────────────────────
    const byCity = new Map<string, { city: string; lead_count: number; avg_score: number; top: LeadRow[] }>();
    for (const l of leads) {
      const city = l.city ?? "Unknown";
      const e = byCity.get(city) ?? { city, lead_count: 0, avg_score: 0, top: [] };
      e.lead_count++;
      e.avg_score += l.score;
      e.top.push(l);
      byCity.set(city, e);
    }
    const cityRanking = Array.from(byCity.values())
      .map((e) => ({
        city: e.city,
        lead_count: e.lead_count,
        avg_score: Math.round(e.avg_score / e.lead_count),
        top_3: e.top
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((l) => ({ id: l.id, name: l.primary_name, score: l.score, score_label: l.score_label })),
      }))
      .sort((a, b) => b.avg_score * b.lead_count - a.avg_score * a.lead_count)
      .slice(0, 20);

    // ── Top operator clusters ────────────────────────────────────────────────
    const clusters = detectOperatorClusters(leads as LeadForClustering[]).slice(0, 15);

    // ── Best multi-property operators ────────────────────────────────────────
    const multiProp = leads
      .filter((l) => (l.estimated_property_count ?? 0) >= 3)
      .sort((a, b) => (b.estimated_property_count ?? 0) - (a.estimated_property_count ?? 0))
      .slice(0, 15)
      .map((l) => ({
        id: l.id,
        name: l.primary_name,
        city: l.city,
        estimated_property_count: l.estimated_property_count,
        score: l.score,
      }));

    // ── Highest revenue upside (no-website + high score) ─────────────────────
    const revenueUpside = leads
      .filter((l) => !l.website_url && l.score >= 60)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map((l) => ({
        id: l.id,
        name: l.primary_name,
        city: l.city,
        score: l.score,
        has_phone: Boolean(l.phone),
        lead_type: l.lead_type,
      }));

    // ── Weird-signal frequency ───────────────────────────────────────────────
    const signalCounts = new Map<string, { code: string; severity: string; count: number; description: string }>();
    for (const l of leads) {
      const sigs = scanLeadForWeirdSignals(l as LeadForSignals);
      for (const s of sigs) {
        const e = signalCounts.get(s.code) ?? {
          code: s.code,
          severity: s.severity,
          count: 0,
          description: s.description,
        };
        e.count++;
        signalCounts.set(s.code, e);
      }
    }
    const topSignals = Array.from(signalCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // ── Compliance health ────────────────────────────────────────────────────
    const compliance = {
      total: leads.length,
      not_contacted: leads.filter((l) => (l.outreach_status ?? "not_contacted") === "not_contacted").length,
      contacted: leads.filter((l) => l.outreach_status === "contacted").length,
      replied: leads.filter((l) => l.outreach_status === "replied").length,
      converted: leads.filter((l) => l.outreach_status === "converted").length,
      opted_out: leads.filter((l) => l.outreach_status === "opted_out").length,
      unsubscribed: leads.filter((l) => l.outreach_status === "unsubscribed").length,
      missing_contact: leads.filter((l) => !l.email && !l.phone).length,
    };

    // ── Coverage ─────────────────────────────────────────────────────────────
    const coverage = {
      total: leads.length,
      with_phone: leads.filter((l) => l.phone).length,
      with_email: leads.filter((l) => l.email).length,
      with_website: leads.filter((l) => l.website_url).length,
      reconstructed: leads.filter((l) => l.reconstructed).length,
      no_website_high_score: leads.filter((l) => !l.website_url && l.score >= 70).length,
    };

    // ── Top leads overall ────────────────────────────────────────────────────
    const topLeads = leads
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((l) => ({
        id: l.id,
        name: l.primary_name,
        city: l.city,
        score: l.score,
        score_label: l.score_label,
        lead_type: l.lead_type,
        has_phone: Boolean(l.phone),
        has_email: Boolean(l.email),
      }));

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      coverage,
      compliance,
      top_leads: topLeads,
      city_ranking: cityRanking,
      operator_clusters: clusters,
      multi_property_operators: multiProp,
      revenue_upside_no_website: revenueUpside,
      top_weird_signals: topSignals,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/dashboard]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/tools/calculate-leak
//
// Public endpoint (no auth) that estimates the annual revenue an STR
// operator leaks to OTA commissions vs taking direct bookings. Used by
// /tools/direct-booking-calculator as a lead magnet — the user submits
// their listing URL + optional email; we return the calculation and (if
// they consented to email) save a Tier-A consented lead.
//
// Math is intentionally conservative and clearly labelled as an estimate.
// We never claim a precise figure; the goal is to flag the order of
// magnitude that justifies a direct-booking conversation.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { validateEmail } from "@/lib/utils/contact-validator";
import { validatePublicUrl } from "@/lib/utils/ssrf";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface LeakInputs {
  listing_url?: string;
  nightly_rate: number;          // EUR per night, average
  nights_booked_per_year: number;
  ota_commission_pct?: number;   // default 15 (Airbnb host + service)
  // Lead-magnet capture (opt-in)
  email?: string;
  email_consent?: boolean;
  city?: string;
}

export async function POST(req: NextRequest) {
  try {
    const input = (await req.json()) as LeakInputs;
    const nightlyRate = Number(input.nightly_rate);
    const nightsPerYear = Number(input.nights_booked_per_year);
    if (!Number.isFinite(nightlyRate) || nightlyRate <= 0)
      return NextResponse.json({ error: "nightly_rate required (€/night)" }, { status: 400 });
    if (!Number.isFinite(nightsPerYear) || nightsPerYear <= 0)
      return NextResponse.json({ error: "nights_booked_per_year required" }, { status: 400 });
    if (nightlyRate > 5000 || nightsPerYear > 365)
      return NextResponse.json({ error: "Values out of plausible range" }, { status: 400 });

    const commissionPct = clamp(input.ota_commission_pct ?? 15, 3, 25);
    const grossRevenue = nightlyRate * nightsPerYear;
    const otaFees = grossRevenue * (commissionPct / 100);
    const directBookingAchievable = grossRevenue * 0.3;           // industry: 20-40% direct after 12 months
    const directBookingSavings = directBookingAchievable * (commissionPct / 100);
    const adviceFreq = grossRevenue >= 30000 ? "monthly" : "quarterly";

    // Consent-based lead capture (opt-in only)
    let lead_id: string | null = null;
    if (input.email_consent && input.email) {
      const v = validateEmail(input.email);
      if (v.valid && v.cleaned) {
        // Validate listing URL if provided so we can attach context
        const listingValid =
          input.listing_url && validatePublicUrl(input.listing_url).ok ? input.listing_url : null;

        const service = createServiceClient();
        // The lead has no `user_id` (the inbound owner doesn't have a Prospect
        // account); we tag it with a special user marker so the orchestrator
        // and review queue can surface "consented inbound" leads to whichever
        // Prospect account is configured as the tools owner.
        const toolsOwner = process.env.PUBLIC_TOOLS_OWNER_USER_ID;
        if (toolsOwner) {
          const { data } = await service
            .from("leads")
            .insert({
              user_id: toolsOwner,
              primary_name: v.cleaned,
              email: v.cleaned,
              lead_type: "Direct Booking Owner",
              city: input.city ?? null,
              country: "France",
              website_url: listingValid,
              source_url: listingValid ?? "https://prospect-2.vercel.app/tools/direct-booking-calculator",
              source_type: "inbound_consent_leak_calculator",
              quality_summary: `Consented inbound from leak calculator: estimated ${Math.round(otaFees)}€/yr OTA leakage on ${Math.round(grossRevenue)}€ gross.`,
              confidence: "high",
              status: "new",
              outreach_status: "consented",
              score: 80,
              score_label: "Hot",
            })
            .select("id")
            .single();
          lead_id = data?.id ?? null;
        }
      }
    }

    return NextResponse.json({
      inputs: { nightlyRate, nightsPerYear, commissionPct },
      gross_annual_revenue: round0(grossRevenue),
      ota_fees_per_year: round0(otaFees),
      direct_booking_target_per_year: round0(directBookingAchievable),
      potential_annual_savings: round0(directBookingSavings),
      advice_frequency_suggestion: adviceFreq,
      // Honest framing — this is a back-of-envelope estimate, not a forecast.
      disclaimer:
        "Estimate based on a 30% achievable direct-booking share after 12 months of structured effort. Actual results depend on market, brand, and conversion work.",
      lead_id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/tools/calculate-leak]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round0(n: number): number {
  return Math.round(n);
}

// POST /api/intent-capture
// Receives a submission from a public consent-based intent-capture form
// (revenue-leak calculator, direct-booking estimator, etc.). Creates a
// lead with an explicit consent record and outreach_status="not_contacted".
//
// Compliance: this is an INBOUND tool. The user voluntarily submits the form
// AND ticks an explicit consent box. The body MUST include consent=true.
// We store consent_log in lead notes for the audit trail.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { validateEmail, validateFrenchPhone } from "@/lib/utils/contact-validator";

export const dynamic = "force-dynamic";

interface CaptureBody {
  // The qualifying form fields (any subset)
  city?: string;
  country?: string;
  property_count?: number;
  has_direct_booking?: boolean;
  monthly_revenue_eur?: number;
  ota_share_percent?: number;
  // Contact
  name?: string;
  email?: string;
  phone?: string;
  company_name?: string;
  // Tool identifier
  tool: "revenue_leak" | "direct_booking_estimator" | "cleaning_benchmark" | "audit_request";
  // GDPR consent — MUST be true
  consent: boolean;
  // Targeting (which user owns this inbound lead?)
  user_id?: string;
}

interface RevenueLeakResult {
  estimated_annual_ota_commission_eur: number;
  estimated_direct_booking_savings_eur: number;
  pitch: string;
}

function estimateRevenueLeak(b: CaptureBody): RevenueLeakResult | null {
  if (!b.monthly_revenue_eur || !b.ota_share_percent) return null;
  const annualRevenue = b.monthly_revenue_eur * 12;
  const otaRevenue = (annualRevenue * b.ota_share_percent) / 100;
  // Airbnb host service fee + cleaning split etc. ≈ 14-16% effective on host side
  const commission = otaRevenue * 0.15;
  // Conservative: direct booking shifts ~30% of OTA volume → recovers commission on that share
  const directShift = commission * 0.30;
  return {
    estimated_annual_ota_commission_eur: Math.round(commission),
    estimated_direct_booking_savings_eur: Math.round(directShift),
    pitch:
      directShift > 1500
        ? "Your portfolio would recover meaningful direct-booking revenue. Shall we estimate setup time?"
        : "Smaller portfolio — start with a free conversion audit to find the easiest win.",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CaptureBody;

    // ── Compliance gates ────────────────────────────────────────────────────
    if (body.consent !== true)
      return NextResponse.json(
        { error: "Consent is required (consent=true)." },
        { status: 400 }
      );
    if (!body.email && !body.phone)
      return NextResponse.json(
        { error: "At least one contact method (email or phone) is required." },
        { status: 400 }
      );
    if (!body.user_id || typeof body.user_id !== "string")
      return NextResponse.json(
        { error: "user_id (target account this inbound lead belongs to) is required." },
        { status: 400 }
      );

    // ── Validate contacts ───────────────────────────────────────────────────
    let cleanEmail: string | null = null;
    if (body.email) {
      const r = validateEmail(body.email);
      if (!r.valid)
        return NextResponse.json(
          { error: `Invalid email format: ${r.reason}` },
          { status: 400 }
        );
      cleanEmail = r.cleaned ?? body.email;
    }
    let cleanPhone: string | null = null;
    if (body.phone) {
      const r = validateFrenchPhone(body.phone);
      if (!r.valid)
        return NextResponse.json(
          { error: `Invalid French phone format: ${r.reason}` },
          { status: 400 }
        );
      cleanPhone = r.cleaned ?? body.phone;
    }

    // ── Compute the tool's output for the user ──────────────────────────────
    const revenueLeak = body.tool === "revenue_leak" ? estimateRevenueLeak(body) : null;

    // ── Save as a consented inbound lead ────────────────────────────────────
    const service = createServiceClient();

    const consentLogLine =
      `[${new Date().toISOString()}] consent=true tool=${body.tool} ` +
      `via=public_intent_capture` +
      (body.ota_share_percent ? ` ota_share=${body.ota_share_percent}%` : "") +
      (body.monthly_revenue_eur ? ` rev=${body.monthly_revenue_eur}€/mo` : "");

    const { data: inserted, error: insertError } = await service
      .from("leads")
      .insert({
        user_id: body.user_id,
        primary_name: body.name ?? body.company_name ?? body.email ?? "Inbound lead",
        company_name: body.company_name ?? null,
        person_name: body.name ?? null,
        lead_type: "Property Manager",
        city: body.city ?? "",
        country: body.country ?? "France",
        email: cleanEmail,
        phone: cleanPhone,
        source_url: `intent-capture://${body.tool}`,
        source_type: "intent_capture",
        score: 85, // inbound consented leads are top priority by default
        score_label: "Hot",
        confidence: "high",
        status: "new",
        outreach_status: "not_contacted",
        quality_summary: `Inbound consented lead from the public ${body.tool} tool. ${consentLogLine}`,
        notes: consentLogLine,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[intent-capture] DB insert error:", insertError.message);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // ── Audit trail event ───────────────────────────────────────────────────
    await service
      .from("lead_enrichment_events")
      .insert({
        lead_id: inserted!.id,
        provider: "intent_capture",
        status: "consent_recorded",
        error_message: consentLogLine,
      })
      .then(() => undefined)
      .then(undefined, () => undefined);

    return NextResponse.json({
      lead_id: inserted!.id,
      tool: body.tool,
      result: revenueLeak ?? { pitch: "Thanks — we'll be in touch." },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/intent-capture]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/partners/register
//
// Public endpoint (no auth) where cleaning companies, photographers,
// smart-lock installers, designers, accountants etc. self-register with
// their service area. Each registration becomes a consented inbound lead
// tagged source_type=partner_registration_inbound under the tools owner.
//
// Light validation only — we want this form to be welcoming, not punish
// people who forget a field.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { validateEmail, validatePhone } from "@/lib/utils/contact-validator";
import { validatePublicUrl } from "@/lib/utils/ssrf";

export const dynamic = "force-dynamic";

interface RegistrationInput {
  kind?: string;
  name?: string;
  city?: string;
  country?: string;
  website?: string;
  email?: string;
  phone?: string;
  service_area_km?: number;
  notes?: string;
  consent?: boolean;
}

const ALLOWED_KINDS = new Set([
  "cleaning",
  "photography",
  "interior_design",
  "smart_lock",
  "linen",
  "maintenance",
  "accounting",
  "concierge_outsource",
  "other",
]);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RegistrationInput;
    if (!body.consent)
      return NextResponse.json(
        { error: "Consent checkbox must be ticked before we can save your registration." },
        { status: 400 }
      );

    const kind = ALLOWED_KINDS.has(body.kind ?? "") ? body.kind! : "other";
    const name = (body.name ?? "").trim();
    if (name.length < 2)
      return NextResponse.json({ error: "Business name required" }, { status: 400 });

    const city = (body.city ?? "").trim() || null;
    const country = (body.country ?? "France").trim() || "France";
    const websiteRaw = (body.website ?? "").trim();
    const emailRaw = (body.email ?? "").trim();
    const phoneRaw = (body.phone ?? "").trim();
    const notes = (body.notes ?? "").trim().slice(0, 1000);

    // Light validation — pass-through if missing, validator-checked when given.
    let cleanedWebsite: string | null = null;
    if (websiteRaw) {
      const httpUrl = websiteRaw.startsWith("http") ? websiteRaw : `https://${websiteRaw}`;
      const ssrf = validatePublicUrl(httpUrl);
      if (ssrf.ok) cleanedWebsite = httpUrl;
    }
    let cleanedEmail: string | null = null;
    if (emailRaw) {
      const v = validateEmail(emailRaw);
      if (v.valid && v.cleaned) cleanedEmail = v.cleaned;
      else return NextResponse.json({ error: "Email looks invalid." }, { status: 400 });
    }
    let cleanedPhone: string | null = null;
    if (phoneRaw) {
      const v = validatePhone(phoneRaw, "FR");
      if (v.valid && v.e164) cleanedPhone = v.e164;
      // We don't reject silently-invalid phones — they can still call us
      // via email or the website. Just don't store junk.
    }

    if (!cleanedEmail && !cleanedPhone && !cleanedWebsite) {
      return NextResponse.json(
        { error: "Provide at least one contact channel (email, phone or website)." },
        { status: 400 }
      );
    }

    const service = createServiceClient();
    const toolsOwner = process.env.PUBLIC_TOOLS_OWNER_USER_ID;
    if (!toolsOwner) {
      // Without an owner mapping we can't store the registration, but we
      // also don't want to lose it — log it loudly so the admin can wire
      // up the env var.
      console.error(
        "[partner-register] PUBLIC_TOOLS_OWNER_USER_ID is not set; registration discarded:",
        { kind, name, city, website: cleanedWebsite, email: cleanedEmail, phone: cleanedPhone }
      );
      return NextResponse.json(
        { error: "Registrations are temporarily disabled. Please email us." },
        { status: 503 }
      );
    }

    const qualitySummary = [
      `Partner registration (${kind.replace(/_/g, " ")}).`,
      city ? `Service area: ${city}.` : null,
      body.service_area_km ? `Service radius: ${body.service_area_km}km.` : null,
      notes ? `Notes: ${notes}` : null,
      "Consent recorded at registration form.",
    ]
      .filter(Boolean)
      .join(" ");

    const { data, error } = await service
      .from("leads")
      .insert({
        user_id: toolsOwner,
        primary_name: name,
        company_name: name,
        lead_type: "Co-host / Consultant",
        city,
        country,
        website_url: cleanedWebsite,
        email: cleanedEmail,
        phone: cleanedPhone,
        source_url: cleanedWebsite ?? "https://prospect-2.vercel.app/partners/register",
        source_type: `partner_registration:${kind}`,
        quality_summary: qualitySummary,
        confidence: "high",
        status: "new",
        outreach_status: "consented",
        score: 75,
        score_label: "Good",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[partner-register] insert failed:", error.message);
      return NextResponse.json({ error: "Could not save your registration. Please try again." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, lead_id: data?.id ?? null, kind });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/partners/register]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

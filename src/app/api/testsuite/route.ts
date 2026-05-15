// TEMPORARY production diagnostic endpoint. Protected by x-test-key header.
// Probes provider configuration, DB health, contact-validation samples, and
// the new exterior-text-mining + retry-phone paths. Delete after testing.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { validateEmail, validateFrenchPhone } from "@/lib/utils/contact-validator";
import { huntPhone } from "@/lib/engines/phone-hunter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TEST_KEY = "prospect-test-2026-may";

function envFlag(name: string): "configured" | "missing" {
  return process.env[name] ? "configured" : "missing";
}

export async function GET(req: NextRequest) {
  if (req.headers.get("x-test-key") !== TEST_KEY)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const action = req.nextUrl.searchParams.get("action") ?? "summary";
  const service = createServiceClient();

  // ── 1. Provider config ─────────────────────────────────────────────────────
  const providers = {
    SERPAPI_API_KEY: envFlag("SERPAPI_API_KEY"),
    GOOGLE_PLACES_API_KEY: envFlag("GOOGLE_PLACES_API_KEY"),
    GOOGLE_VISION_API_KEY: envFlag("GOOGLE_VISION_API_KEY"),
    MAMMOUTH_API_KEY: envFlag("MAMMOUTH_API_KEY"),
    MAMMOUTH_BASE_URL: process.env.MAMMOUTH_BASE_URL ?? null,
    MAMMOUTH_CHAT_MODEL: process.env.MAMMOUTH_CHAT_MODEL ?? null,
    PAPPERS_API_KEY: envFlag("PAPPERS_API_KEY"),
    HUNTER_API_KEY: envFlag("HUNTER_API_KEY"),
    DROPCONTACT_API_KEY: envFlag("DROPCONTACT_API_KEY"),
    SUPABASE_URL: envFlag("NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: envFlag("SUPABASE_SERVICE_ROLE_KEY"),
  };

  if (action === "providers") return NextResponse.json({ providers });

  // ── 2. Mammouth ping ───────────────────────────────────────────────────────
  if (action === "mammouth_ping") {
    const base = process.env.MAMMOUTH_BASE_URL ?? "https://api.mammouth.ai/v1";
    const key = process.env.MAMMOUTH_API_KEY;
    if (!key) return NextResponse.json({ error: "MAMMOUTH_API_KEY not set" });
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: process.env.MAMMOUTH_CHAT_MODEL ?? "gpt-4o",
          messages: [{ role: "user", content: 'reply with the exact word: PONG' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await r.text();
      return NextResponse.json({ status: r.status, ok: r.ok, body: body.slice(0, 400) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "fail" });
    }
  }

  // ── 3. DB stats + stuck runs ───────────────────────────────────────────────
  if (action === "db_stats") {
    const [{ count: leadsCount }, { data: stuck }, { data: recentRuns }] = await Promise.all([
      service.from("leads").select("*", { count: "exact", head: true }),
      service
        .from("search_runs")
        .select("id, city, status, progress, created_at, finished_at")
        .not("status", "in", "(completed,failed,cancelled)")
        .lt(
          "created_at",
          new Date(Date.now() - 30 * 60_000).toISOString()
        )
        .limit(20),
      service
        .from("search_runs")
        .select("id, city, status, progress, lead_count, created_at, finished_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    return NextResponse.json({ leads_count: leadsCount, stuck_runs: stuck, recent_runs: recentRuns });
  }

  // ── 4. Sample bad leads (revalidate stored email/phone) ────────────────────
  if (action === "sample_bad_contacts") {
    const { data: leads } = await service
      .from("leads")
      .select("id, primary_name, city, email, phone")
      .or("email.not.is.null,phone.not.is.null")
      .order("created_at", { ascending: false })
      .limit(200);

    const bad: Array<{
      id: string;
      name: string;
      city: string;
      field: "email" | "phone";
      value: string;
      reason: string;
    }> = [];
    for (const l of leads ?? []) {
      if (l.email) {
        const r = validateEmail(l.email);
        if (!r.valid)
          bad.push({ id: l.id, name: l.primary_name, city: l.city, field: "email", value: l.email, reason: r.reason ?? "" });
      }
      if (l.phone) {
        const r = validateFrenchPhone(l.phone);
        if (!r.valid)
          bad.push({ id: l.id, name: l.primary_name, city: l.city, field: "phone", value: l.phone, reason: r.reason ?? "" });
      }
    }
    return NextResponse.json({ scanned: leads?.length ?? 0, bad_count: bad.length, samples: bad.slice(0, 30) });
  }

  // ── 5. Validator unit-test ─────────────────────────────────────────────────
  if (action === "validator_tests") {
    const phoneCases: Array<[string, boolean]> = [
      ["06 12 34 56 78", true],
      ["+33 6 12 34 56 78", true],
      ["%2B33%205%2059%2051%2000%2000", true],
      ["+3&#51;&#54; 12 34 56 78", false],
      ["077133191", false],
      ["+330535455800", false],
      ["134217728", false],
      ["2025-02-06 12", false],
      ["0000000000", false],
      ["5475 21.23", false],
    ];
    const emailCases: Array<[string, boolean]> = [
      ["bonjour@example.fr", false], // example.fr now rejected, fine
      ["info@savoielac.com", true],
      ["serv@ions.plus", false],
      [".r@ing-badge.stars", false],
      ["d@alayer.push", false],
      ["navig@or.useragent.match", false],
      [".wp-block-post-templ@e.is", false],
      ["marinevitrac@gmail.com", true],
      ["hello@tranquilleemile.com", true],
    ];

    const phones = phoneCases.map(([raw, expectedValid]) => {
      const r = validateFrenchPhone(raw);
      return { raw, expected: expectedValid, got: r.valid, cleaned: r.cleaned, reason: r.reason, pass: r.valid === expectedValid };
    });
    const emails = emailCases.map(([raw, expectedValid]) => {
      const r = validateEmail(raw);
      return { raw, expected: expectedValid, got: r.valid, cleaned: r.cleaned, reason: r.reason, pass: r.valid === expectedValid };
    });
    return NextResponse.json({
      phones,
      emails,
      summary: {
        phones_passing: phones.filter((p) => p.pass).length + "/" + phones.length,
        emails_passing: emails.filter((e) => e.pass).length + "/" + emails.length,
      },
    });
  }

  // ── 6. Coverage stats — how many leads have phone / email / website? ──────
  if (action === "coverage") {
    const [total, withPhone, withEmail, withWebsite, recon] = await Promise.all([
      service.from("leads").select("*", { count: "exact", head: true }),
      service.from("leads").select("*", { count: "exact", head: true }).not("phone", "is", null),
      service.from("leads").select("*", { count: "exact", head: true }).not("email", "is", null),
      service.from("leads").select("*", { count: "exact", head: true }).not("website_url", "is", null),
      service.from("leads").select("*", { count: "exact", head: true }).eq("reconstructed", true),
    ]);
    return NextResponse.json({
      total: total.count,
      with_phone: withPhone.count,
      with_email: withEmail.count,
      with_website: withWebsite.count,
      reconstructed: recon.count,
    });
  }

  // ── 7. Retry-phone simulation on the most recent visual-reconstruction lead ─
  if (action === "retry_phone_sim") {
    const { data: lead } = await service
      .from("leads")
      .select("*")
      .eq("reconstructed", true)
      .is("phone", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!lead) return NextResponse.json({ error: "No suitable lead found" });

    const geo = typeof lead.geo_signals === "string"
      ? JSON.parse(lead.geo_signals) as Record<string, unknown>
      : (lead.geo_signals as Record<string, unknown> | null) ?? {};
    const detected = geo.detected_location as { latitude?: number; longitude?: number; address?: string } | undefined;
    const exterior = geo.exterior_signals as Parameters<typeof huntPhone>[0]["exterior_signals"];
    const postal = lead.address?.match(/\b(\d{5})\b/)?.[1];

    const start = Date.now();
    const phones = await huntPhone({
      operator_name: lead.company_name ?? lead.primary_name,
      host_name: lead.person_name ?? undefined,
      address: lead.address ?? detected?.address,
      city: lead.city,
      country: lead.country,
      has_website: Boolean(lead.website_url),
      latitude: detected?.latitude,
      longitude: detected?.longitude,
      postal_code: postal,
      exterior_signals: exterior,
    });
    return NextResponse.json({
      lead_id: lead.id,
      lead_name: lead.primary_name,
      city: lead.city,
      has_exterior_signals: Boolean(exterior),
      exterior_signals: exterior
        ? {
            surnames: exterior.surnames?.length ?? 0,
            property_names: exterior.property_names?.length ?? 0,
            permit: Boolean(exterior.permit_info),
          }
        : null,
      took_ms: Date.now() - start,
      phones_found: phones.length,
      top_5: phones.slice(0, 5),
    });
  }

  // ── default summary ────────────────────────────────────────────────────────
  return NextResponse.json({
    actions: [
      "providers",
      "mammouth_ping",
      "db_stats",
      "sample_bad_contacts",
      "validator_tests",
    ],
    providers,
  });
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-test-key") !== TEST_KEY)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const service = createServiceClient();

  if (body.action === "clean_bad_contacts") {
    const { data: leads } = await service
      .from("leads")
      .select("id, email, phone")
      .or("email.not.is.null,phone.not.is.null");
    let cleanedEmails = 0;
    let cleanedPhones = 0;
    for (const l of leads ?? []) {
      const updates: { email?: string | null; phone?: string | null } = {};
      if (l.email && !validateEmail(l.email).valid) {
        updates.email = null;
        cleanedEmails++;
      }
      if (l.phone && !validateFrenchPhone(l.phone).valid) {
        updates.phone = null;
        cleanedPhones++;
      }
      if (Object.keys(updates).length > 0) {
        await service.from("leads").update(updates).eq("id", l.id);
      }
    }
    return NextResponse.json({
      scanned: leads?.length ?? 0,
      cleaned_emails: cleanedEmails,
      cleaned_phones: cleanedPhones,
    });
  }

  if (body.action === "fix_stuck_runs") {
    const { data, error } = await service
      .from("search_runs")
      .update({
        status: "failed",
        error_message: "Auto-failed: stuck > 30 min",
        finished_at: new Date().toISOString(),
      })
      .not("status", "in", "(completed,failed,cancelled)")
      .lt("created_at", new Date(Date.now() - 30 * 60_000).toISOString())
      .select("id");
    return NextResponse.json({ updated: data?.length ?? 0, error: error?.message });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

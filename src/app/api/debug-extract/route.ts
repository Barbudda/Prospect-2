// TEMPORARY DIAGNOSTIC — POST a URL, see what the extractor returns.
// Protected by x-debug-key header. Delete after diagnosis.

import { NextRequest, NextResponse } from "next/server";
import { extractContactsFromWebsite } from "@/lib/engines/contact-extractor";
import { validateFrenchPhone } from "@/lib/utils/contact-validator";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEBUG_KEY = "extract-debug-2026";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-debug-key") !== DEBUG_KEY)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as { url?: string };
  if (!body.url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const t0 = Date.now();
  const contacts = await extractContactsFromWebsite(body.url, { maxPages: 8, timeoutMs: 12_000 });
  const dur = Date.now() - t0;

  // Also re-validate each phone with the strict validator to surface which
  // are being accepted vs filtered out.
  const phoneAudit = (contacts?.phones ?? []).map((p) => {
    const rawValid = validateFrenchPhone(p.raw);
    const normValid = p.normalized ? validateFrenchPhone(p.normalized) : null;
    return {
      raw: p.raw,
      normalized: p.normalized,
      source: p.source,
      confidence: p.confidence,
      raw_passes_strict_validator: rawValid.valid,
      raw_reason: rawValid.reason,
      normalized_passes_strict_validator: normValid?.valid ?? null,
    };
  });

  return NextResponse.json({
    duration_ms: dur,
    target_url: body.url,
    contacts,
    phone_audit: phoneAudit,
    summary: {
      emails_found: contacts?.emails?.length ?? 0,
      phones_found: contacts?.phones?.length ?? 0,
      phones_that_pass_strict_validator: phoneAudit.filter((p) => p.raw_passes_strict_validator || p.normalized_passes_strict_validator).length,
    },
  });
}

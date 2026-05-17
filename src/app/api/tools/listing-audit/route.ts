// POST /api/tools/listing-audit
//
// Public, no-auth endpoint that runs a Lighthouse-style audit against any
// public URL and returns a grade with concrete remediation items. Powers
// the /tools/listing-audit page. If the user opts in with an email, we
// save a consented inbound lead under the tools owner.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { auditWebsite } from "@/lib/engines/website-auditor";
import { validateEmail } from "@/lib/utils/contact-validator";
import { validatePublicUrl } from "@/lib/utils/ssrf";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface AuditInputs {
  url: string;
  email?: string;
  email_consent?: boolean;
  city?: string;
}

export async function POST(req: NextRequest) {
  try {
    const input = (await req.json()) as AuditInputs;
    if (!input.url || typeof input.url !== "string")
      return NextResponse.json({ error: "url required" }, { status: 400 });

    // SSRF gate — only public URLs are auditable.
    const ssrf = validatePublicUrl(input.url);
    if (!ssrf.ok)
      return NextResponse.json({ error: `URL refused: ${ssrf.error ?? "not public"}` }, { status: 400 });

    const result = await auditWebsite(input.url);

    // Consent-based lead capture (opt-in only)
    let lead_id: string | null = null;
    if (input.email_consent && input.email) {
      const v = validateEmail(input.email);
      if (v.valid && v.cleaned) {
        const service = createServiceClient();
        const toolsOwner = process.env.PUBLIC_TOOLS_OWNER_USER_ID;
        if (toolsOwner) {
          const score = result.audit_score ?? 50;
          const { data } = await service
            .from("leads")
            .insert({
              user_id: toolsOwner,
              primary_name: v.cleaned,
              email: v.cleaned,
              lead_type: "Direct Booking Owner",
              city: input.city ?? null,
              country: "France",
              website_url: input.url,
              source_url: input.url,
              source_type: "inbound_consent_listing_audit",
              quality_summary: `Consented inbound from listing audit: site scored ${score}/100. ${result.findings.length} finding(s).`,
              confidence: "high",
              status: "new",
              outreach_status: "consented",
              // Lower audit score == bigger opportunity to talk about
              score: Math.max(50, 100 - score),
              score_label: score < 50 ? "Hot" : score < 75 ? "Good" : "Medium",
            })
            .select("id")
            .single();
          lead_id = data?.id ?? null;
        }
      }
    }

    return NextResponse.json({ ...result, lead_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/tools/listing-audit]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

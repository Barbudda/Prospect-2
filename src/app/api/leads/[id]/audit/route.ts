// POST /api/leads/[id]/audit
// Runs the public-website auditor on a lead's website_url. Optional
// ?with_outreach=1 also asks Mammouth to generate a lost-revenue hypothesis
// and a personalised outreach snippet from the findings.
//
// Compliance: read-only fetch of the public homepage. Result is returned to
// the caller and logged as a lead_enrichment_event for the audit trail. No
// personal data is collected.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { auditWebsite } from "@/lib/engines/website-auditor";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
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
      .select("id, website_url, primary_name")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (error || !lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!lead.website_url)
      return NextResponse.json(
        { error: "Lead has no website_url — nothing to audit." },
        { status: 400 }
      );

    const withOutreach = req.nextUrl.searchParams.get("with_outreach") === "1";

    const audit = await auditWebsite(lead.website_url, {
      generate_outreach: withOutreach,
    });

    // Audit trail
    const service = createServiceClient();
    await service
      .from("lead_enrichment_events")
      .insert({
        lead_id: id,
        provider: "website_auditor",
        status: audit.fetched ? "success" : "failed",
        error_message: audit.fetched ? null : audit.findings[0]?.description ?? "fetch failed",
      })
      .then(() => undefined)
      .then(undefined, () => undefined);

    return NextResponse.json(audit);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/[id]/audit]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

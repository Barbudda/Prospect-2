// POST /api/leads/bulk-dnc
// Bulk-mark multiple leads as Do-Not-Contact. Each lead gets its contact
// data nulled (strict data minimisation) and is logged to the audit trail.
//
// Body: { lead_ids: string[], reason?: string }

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { markLeadDoNotContact } from "@/lib/utils/compliance";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as { lead_ids: string[]; reason?: string };
    if (!Array.isArray(body.lead_ids) || body.lead_ids.length === 0)
      return NextResponse.json({ error: "lead_ids required" }, { status: 400 });
    if (body.lead_ids.length > 500)
      return NextResponse.json({ error: "Max 500 leads per call" }, { status: 400 });

    const service = createServiceClient();
    let processed = 0;
    let failed = 0;

    // Sequential — keeps writes simple and avoids hammering RLS
    for (const id of body.lead_ids) {
      try {
        const result = await markLeadDoNotContact(service, id, user.id, {
          reason: body.reason ?? "Bulk DNC from leads list",
          source: "bulk_user_action",
          also_null_contacts: true,
        });
        if (result.ok) processed++;
        else failed++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ processed, failed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/bulk-dnc]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

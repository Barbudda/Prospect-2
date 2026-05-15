// POST /api/leads/[id]/dnc
// Marks a lead Do-Not-Contact: sets outreach_status=opted_out, nulls contact
// fields (email/phone/whatsapp), logs the event to lead_enrichment_events.
//
// Compliance: this is the GDPR "right to object" + suppression list primitive.
// Once a lead is DNC'd, every future contact-extraction path checks against
// this same outreach_status before saving new contact data.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { markLeadDoNotContact } from "@/lib/utils/compliance";

export const dynamic = "force-dynamic";

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

    const body = (await req.json().catch(() => ({}))) as {
      reason?: string;
      keep_contacts?: boolean;
    };

    const service = createServiceClient();
    const result = await markLeadDoNotContact(service, id, user.id, {
      reason: body.reason,
      source: "manual_user_action",
      also_null_contacts: !body.keep_contacts,
    });

    if (!result.ok)
      return NextResponse.json({ error: result.error ?? "Failed" }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/[id]/dnc]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

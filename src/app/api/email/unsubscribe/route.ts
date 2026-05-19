// GET  /api/email/unsubscribe?mid=<message_id>   one-click via mail client
// POST /api/email/unsubscribe?mid=<message_id>   one-click POST (RFC 8058)
//
// The `List-Unsubscribe` header in every outbound email points here so
// Gmail / Outlook can offer their built-in unsubscribe UI. The route is
// public on purpose — no auth — because the recipient (not the sender)
// is acting. We resolve the message_id back to the lead and add the
// email to the sender's suppression list. Returns a plain-text body
// so it renders fine in any mail client preview.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { addToSuppressionList } from "@/lib/utils/suppression";

export const dynamic = "force-dynamic";

async function unsubscribe(messageId: string) {
  const service = createServiceClient();
  const { data: msg } = await service
    .from("email_messages")
    .select("user_id, lead_id, to_email")
    .eq("id", messageId)
    .single();

  if (!msg || !msg.to_email) {
    return new Response(
      "We could not find that subscription. If you keep hearing from us, reply STOP and we'll fix it manually.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  await addToSuppressionList(service, msg.user_id, [
    {
      email: msg.to_email,
      reason: "auto: list-unsubscribe one-click",
      source: "one_click_unsubscribe",
      source_lead_id: msg.lead_id,
    },
  ]);

  if (msg.lead_id) {
    await service
      .from("leads")
      .update({ outreach_status: "unsubscribed" })
      .eq("id", msg.lead_id)
      .eq("user_id", msg.user_id);
  }

  return new Response(
    `You're unsubscribed.\n\n${msg.to_email} will not receive further outreach from us.\nIf you have any other emails from us in the past, you can reply STOP to those too and we'll suppress immediately.\n\n— Prospect`,
    { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

export async function GET(req: NextRequest) {
  const mid = new URL(req.url).searchParams.get("mid");
  if (!mid)
    return new NextResponse("Missing message id.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  return unsubscribe(mid);
}

export async function POST(req: NextRequest) {
  // Gmail uses POST for one-click unsubscribe per RFC 8058.
  let mid = new URL(req.url).searchParams.get("mid");
  if (!mid) {
    try {
      const body = await req.json();
      mid = body?.mid ?? null;
    } catch {
      /* ignore */
    }
  }
  if (!mid)
    return new NextResponse("Missing message id.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  return unsubscribe(mid);
}

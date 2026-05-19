// POST /api/email/webhook/resend
//
// Resend webhook handler. Subscribe to events in Resend dashboard:
//   email.sent, email.delivered, email.delivery_delayed,
//   email.bounced, email.complained, email.opened, email.clicked
// Bounces and complaints auto-suppress the recipient so the next
// campaign drops them without operator intervention.
//
// Signing: Resend signs payloads with Svix. Configure RESEND_WEBHOOK_SECRET
// in Vercel env. If unset (local dev) the route still works but with no
// signature check — production deploys MUST set the secret.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { addToSuppressionList } from "@/lib/utils/suppression";
import { Webhook } from "svix";

export const dynamic = "force-dynamic";

interface ResendEvent {
  type: string;
  created_at: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    tags?: Array<{ name: string; value: string }>;
  };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let event: ResendEvent;

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    try {
      const wh = new Webhook(secret);
      const headers = {
        "svix-id": req.headers.get("svix-id") ?? "",
        "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
        "svix-signature": req.headers.get("svix-signature") ?? "",
      };
      event = wh.verify(raw, headers) as ResendEvent;
    } catch (err) {
      console.warn("[resend webhook] signature verification failed:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else {
    // Best-effort parse when no secret is configured (dev only).
    try {
      event = JSON.parse(raw) as ResendEvent;
    } catch {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }
  }

  const service = createServiceClient();

  // Find the message_id tag we embedded at send time.
  const messageTag = event.data?.tags?.find((t) => t.name === "message_id");
  const messageId = messageTag?.value;
  if (!messageId) {
    // Without our tag we can't reconcile back to a row, but we still
    // want a 200 so Resend doesn't retry.
    return NextResponse.json({ ok: true, ignored: "no message_id tag" });
  }

  const now = new Date().toISOString();

  // Look up the message + its user/lead context so we can suppress on bounce.
  const { data: msg } = await service
    .from("email_messages")
    .select("id, user_id, lead_id, to_email")
    .eq("id", messageId)
    .single();

  if (!msg) {
    return NextResponse.json({ ok: true, ignored: "message not found" });
  }

  const updates: Record<string, unknown> = {};

  switch (event.type) {
    case "email.sent":
      updates.status = "sent";
      if (!event.data?.email_id) break;
      updates.resend_id = event.data.email_id;
      updates.sent_at = now;
      break;
    case "email.delivered":
      updates.status = "delivered";
      updates.delivered_at = now;
      break;
    case "email.opened":
      updates.status = "opened";
      updates.opened_at = now;
      break;
    case "email.clicked":
      updates.status = "clicked";
      updates.clicked_at = now;
      break;
    case "email.bounced":
      updates.status = "bounced";
      updates.bounced_at = now;
      updates.error = "bounced";
      // Auto-suppress to prevent re-sending to a bad address.
      await addToSuppressionList(service, msg.user_id, [
        {
          email: msg.to_email,
          reason: "auto: hard bounce",
          source: "resend_webhook",
          source_lead_id: msg.lead_id,
        },
      ]);
      break;
    case "email.complained":
      updates.status = "complained";
      updates.complained_at = now;
      updates.error = "spam complaint";
      // Spam complaint = strongest signal to suppress.
      await addToSuppressionList(service, msg.user_id, [
        {
          email: msg.to_email,
          reason: "auto: spam complaint",
          source: "resend_webhook",
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
      break;
    default:
      // delivery_delayed, etc. — ignore for now but ack.
      return NextResponse.json({ ok: true, ignored: event.type });
  }

  if (Object.keys(updates).length > 0) {
    await service.from("email_messages").update(updates).eq("id", messageId);
  }

  return NextResponse.json({ ok: true });
}

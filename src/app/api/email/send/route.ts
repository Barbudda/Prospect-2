// POST /api/email/send
// Single-recipient send. Respects suppression list + 90-day frequency cap
// (override with body.force=true). Used by the /mailing page when the
// user wants to send one carefully-edited email rather than a campaign.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendOneEmail } from "@/lib/email/resend-client";
import { loadSuppressionSet, isSuppressed } from "@/lib/utils/suppression";
import { checkPerLeadCap } from "@/lib/utils/outreach-cap";
import { validateEmail } from "@/lib/utils/contact-validator";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface SendBody {
  lead_id?: string;
  to?: string;            // override if no lead id (manual address)
  subject: string;
  body: string;
  html?: string;
  force?: boolean;
  reply_to?: string;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as SendBody;
    if (!body.subject?.trim() || !body.body?.trim())
      return NextResponse.json({ error: "subject and body required" }, { status: 400 });

    const service = createServiceClient();

    // Resolve the recipient — either from a lead row or an explicit address.
    let toEmail: string | null = null;
    let toName: string | null = null;
    let leadId: string | null = null;
    let leadOutreachGeneratedAt: string | null = null;

    if (body.lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("id, email, primary_name, outreach_generated_at, outreach_status")
        .eq("id", body.lead_id)
        .eq("user_id", user.id)
        .single();
      if (!lead?.email) {
        return NextResponse.json({ error: "Lead has no email on file." }, { status: 400 });
      }
      if (lead.outreach_status === "opted_out" || lead.outreach_status === "unsubscribed") {
        return NextResponse.json(
          { error: "Lead is opted out / unsubscribed.", suppressed: true },
          { status: 409 }
        );
      }
      toEmail = lead.email;
      toName = lead.primary_name ?? null;
      leadId = lead.id;
      leadOutreachGeneratedAt = lead.outreach_generated_at ?? null;
    } else if (body.to) {
      const v = validateEmail(body.to);
      if (!v.valid || !v.cleaned)
        return NextResponse.json({ error: `Invalid recipient email: ${v.reason ?? ""}` }, { status: 400 });
      toEmail = v.cleaned;
    } else {
      return NextResponse.json({ error: "Provide either lead_id or to" }, { status: 400 });
    }

    // Suppression list — never let a manual send bypass DNC.
    const suppressed = await loadSuppressionSet(service, user.id);
    const sup = isSuppressed(suppressed, { email: toEmail });
    if (sup.suppressed) {
      return NextResponse.json(
        { error: `Recipient is on your do-not-contact list (${sup.reason}).`, suppressed: true },
        { status: 409 }
      );
    }

    // Frequency cap (per-lead only — manual sends with no lead skip the cap).
    if (leadId && !body.force) {
      const decision = checkPerLeadCap(leadOutreachGeneratedAt);
      if (!decision.allowed) {
        return NextResponse.json(
          { error: decision.reason, retry_after: decision.retry_after, frequency_capped: true },
          { status: 429 }
        );
      }
    }

    // Pre-create the message row so the webhook can correlate by message_id.
    const { data: msgRow, error: msgErr } = await service
      .from("email_messages")
      .insert({
        user_id: user.id,
        lead_id: leadId,
        to_email: toEmail,
        to_name: toName,
        subject: body.subject.trim(),
        body: body.body.trim(),
        status: "sending",
      })
      .select("id")
      .single();
    if (msgErr || !msgRow) {
      return NextResponse.json({ error: msgErr?.message ?? "Could not queue message" }, { status: 500 });
    }

    const result = await sendOneEmail({
      to: toEmail!,
      to_name: toName ?? undefined,
      subject: body.subject.trim(),
      body: body.body.trim(),
      html: body.html,
      message_id: msgRow.id,
      reply_to: body.reply_to,
    });

    if (!result.ok) {
      await service
        .from("email_messages")
        .update({ status: "failed", error: result.error ?? "send failed" })
        .eq("id", msgRow.id);
      return NextResponse.json(
        { error: result.error ?? "Send failed", fatal: result.fatal },
        { status: result.fatal ? 400 : 502 }
      );
    }

    const sentAt = new Date().toISOString();
    await service
      .from("email_messages")
      .update({ status: "sent", resend_id: result.resend_id ?? null, sent_at: sentAt })
      .eq("id", msgRow.id);

    if (leadId) {
      await service
        .from("leads")
        .update({ outreach_generated_at: sentAt, outreach_status: "contacted" })
        .eq("id", leadId)
        .eq("user_id", user.id);
    }

    return NextResponse.json({ ok: true, message_id: msgRow.id, resend_id: result.resend_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/email/send]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/email/campaign
//
// Mass-mailing endpoint. Creates an email_campaigns row and a queued
// email_messages row per selected lead, then sends them sequentially
// (with a small inter-send delay) via Resend. Every safeguard from the
// single-send route applies, plus per-domain throttling so we never
// hammer the same domain harder than 1 send per 2 seconds.
//
// Inputs:
//   kind: "manual" | "general_template" | "rag_per_lead"
//   lead_ids: string[]                           explicit lead selection
//   filters: { … }                               OR a filter dsl (future)
//   subject, body                                for manual / general_template
//   subject_template, body_template              templated form (with
//                                                {{primary_name}} / {{city}} / …)
//   rag_prompt                                   the user's chat input
//   rag_subject_per_lead, rag_body_per_lead      precomputed per-lead drafts
//                                                (the chatbot UI builds these
//                                                so the executor doesn't have
//                                                to call Anthropic again)
//   force?: boolean                              bypass per-lead 90d cap
//   dry_run?: boolean                            queue everything but skip
//                                                actual Resend calls
//
// The route returns once every selected lead has been resolved into a
// per-lead status. Because Vercel caps function duration, the executor
// processes leads in priority order and bails (with a partial response)
// when budget runs low — callers can press the button again to resume.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendOneEmail } from "@/lib/email/resend-client";
import { loadSuppressionSet, isSuppressed } from "@/lib/utils/suppression";
import { checkPerLeadCap } from "@/lib/utils/outreach-cap";
import { applyTemplate, type LeadForCompose } from "@/lib/email/compose";

export const dynamic = "force-dynamic";
// 90s gives us comfortable headroom for ~25-40 messages. The route
// supports resume-on-press if a large batch can't finish in one go.
export const maxDuration = 90;

const TOTAL_BUDGET_MS = 80_000;
const INTER_SEND_SLEEP_MS = 350;
const PER_DOMAIN_MIN_GAP_MS = 1_800;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type CampaignKind = "manual" | "general_template" | "rag_per_lead";

interface CampaignBody {
  kind: CampaignKind;
  name?: string;
  lead_ids: string[];
  // Manual + general_template share these
  subject?: string;
  body?: string;
  // RAG per-lead — UI passes the precomputed drafts keyed by lead_id
  rag_prompt?: string;
  rag_drafts?: Record<string, { subject: string; body: string }>;
  from_email?: string;
  from_name?: string;
  reply_to?: string;
  force?: boolean;
  dry_run?: boolean;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as CampaignBody;
    if (!["manual", "general_template", "rag_per_lead"].includes(body.kind))
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    if (!Array.isArray(body.lead_ids) || body.lead_ids.length === 0)
      return NextResponse.json({ error: "lead_ids required" }, { status: 400 });
    if (body.lead_ids.length > 250)
      return NextResponse.json(
        { error: "Max 250 leads per campaign. Split into multiple batches." },
        { status: 400 }
      );

    const service = createServiceClient();

    // Pull leads up-front with everything the composer might need.
    const { data: leads, error: leadsErr } = await service
      .from("leads")
      .select(
        "id, primary_name, person_name, company_name, lead_type, city, country, website_url, email, phone, quality_summary, suggested_angle, superhost, review_count, estimated_property_count, has_booking_engine, has_chatbot, automation_level, outreach_generated_at, outreach_status"
      )
      .eq("user_id", user.id)
      .in("id", body.lead_ids);

    if (leadsErr || !leads)
      return NextResponse.json({ error: leadsErr?.message ?? "Lead lookup failed" }, { status: 500 });

    // Create the campaign shell early so partial executions still appear in /mailing history.
    const { data: campaign, error: campErr } = await service
      .from("email_campaigns")
      .insert({
        user_id: user.id,
        name: body.name ?? `Campaign ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
        kind: body.kind,
        subject_template: body.kind === "rag_per_lead" ? null : body.subject ?? null,
        body_template: body.kind === "rag_per_lead" ? null : body.body ?? null,
        rag_prompt: body.rag_prompt ?? null,
        from_email: body.from_email ?? null,
        from_name: body.from_name ?? null,
        reply_to: body.reply_to ?? null,
        total_recipients: leads.length,
      })
      .select("id")
      .single();

    if (campErr || !campaign)
      return NextResponse.json(
        { error: campErr?.message ?? "Could not create campaign" },
        { status: 500 }
      );

    // Load suppression list once for the whole batch.
    const suppressed = await loadSuppressionSet(service, user.id);
    const domainLastSend = new Map<string, number>();

    interface Detail {
      lead_id: string;
      status: "sent" | "failed" | "skipped";
      reason?: string;
      resend_id?: string;
      message_id?: string;
    }
    const details: Detail[] = [];
    let sentCount = 0;
    let failedCount = 0;
    let skippedSuppressed = 0;
    let skippedFrequencyCap = 0;
    let skippedNoEmail = 0;
    let skippedBudget = 0;

    for (const lead of leads) {
      // Budget guard — leave room for response serialisation.
      if (elapsed() > TOTAL_BUDGET_MS) {
        skippedBudget++;
        details.push({ lead_id: lead.id, status: "skipped", reason: "budget_exhausted" });
        continue;
      }

      if (!lead.email) {
        skippedNoEmail++;
        details.push({ lead_id: lead.id, status: "skipped", reason: "no_email" });
        continue;
      }
      if (lead.outreach_status === "opted_out" || lead.outreach_status === "unsubscribed") {
        skippedSuppressed++;
        details.push({ lead_id: lead.id, status: "skipped", reason: "lead_opted_out" });
        continue;
      }
      const sup = isSuppressed(suppressed, { email: lead.email, phone: lead.phone });
      if (sup.suppressed) {
        skippedSuppressed++;
        details.push({ lead_id: lead.id, status: "skipped", reason: `suppressed:${sup.reason}` });
        continue;
      }
      if (!body.force) {
        const cap = checkPerLeadCap(lead.outreach_generated_at);
        if (!cap.allowed) {
          skippedFrequencyCap++;
          details.push({ lead_id: lead.id, status: "skipped", reason: cap.reason });
          continue;
        }
      }

      // Per-domain throttle (e.g. 8 leads at gmail.com -> 1 every ~2s)
      const domain = lead.email.split("@")[1]?.toLowerCase();
      if (domain) {
        const last = domainLastSend.get(domain) ?? 0;
        const gap = Date.now() - last;
        if (gap < PER_DOMAIN_MIN_GAP_MS) await sleep(PER_DOMAIN_MIN_GAP_MS - gap);
      }

      // Resolve subject + body for this lead based on the campaign kind.
      let subject = "";
      let bodyText = "";
      if (body.kind === "rag_per_lead") {
        const draft = body.rag_drafts?.[lead.id];
        if (!draft) {
          skippedNoEmail++;
          details.push({ lead_id: lead.id, status: "skipped", reason: "missing_rag_draft" });
          continue;
        }
        subject = draft.subject;
        bodyText = draft.body;
      } else if (body.kind === "general_template") {
        subject = applyTemplate(body.subject ?? "", lead as LeadForCompose);
        bodyText = applyTemplate(body.body ?? "", lead as LeadForCompose);
      } else {
        subject = body.subject ?? "";
        bodyText = body.body ?? "";
      }
      if (!subject.trim() || !bodyText.trim()) {
        failedCount++;
        details.push({ lead_id: lead.id, status: "failed", reason: "empty_subject_or_body" });
        continue;
      }

      // Persist queued row first so the webhook can reconcile.
      const { data: msgRow, error: msgErr } = await service
        .from("email_messages")
        .insert({
          campaign_id: campaign.id,
          user_id: user.id,
          lead_id: lead.id,
          to_email: lead.email,
          to_name: lead.primary_name,
          subject,
          body: bodyText,
          status: "sending",
        })
        .select("id")
        .single();
      if (msgErr || !msgRow) {
        failedCount++;
        details.push({ lead_id: lead.id, status: "failed", reason: msgErr?.message ?? "queue_failed" });
        continue;
      }

      if (body.dry_run) {
        await service
          .from("email_messages")
          .update({ status: "queued", error: "dry_run" })
          .eq("id", msgRow.id);
        details.push({ lead_id: lead.id, status: "sent", reason: "dry_run", message_id: msgRow.id });
        continue;
      }

      const result = await sendOneEmail({
        to: lead.email,
        to_name: lead.primary_name ?? undefined,
        subject,
        body: bodyText,
        message_id: msgRow.id,
        from: body.from_email,
        from_name: body.from_name,
        reply_to: body.reply_to,
      });

      if (!result.ok) {
        failedCount++;
        await service
          .from("email_messages")
          .update({ status: "failed", error: result.error ?? "send failed" })
          .eq("id", msgRow.id);
        details.push({
          lead_id: lead.id,
          status: "failed",
          reason: result.error ?? "send_failed",
          message_id: msgRow.id,
        });
        continue;
      }

      const sentAt = new Date().toISOString();
      await service
        .from("email_messages")
        .update({ status: "sent", resend_id: result.resend_id ?? null, sent_at: sentAt })
        .eq("id", msgRow.id);
      await service
        .from("leads")
        .update({ outreach_generated_at: sentAt, outreach_status: "contacted" })
        .eq("id", lead.id)
        .eq("user_id", user.id);

      sentCount++;
      if (domain) domainLastSend.set(domain, Date.now());
      details.push({
        lead_id: lead.id,
        status: "sent",
        resend_id: result.resend_id,
        message_id: msgRow.id,
      });
      await sleep(INTER_SEND_SLEEP_MS);
    }

    await service
      .from("email_campaigns")
      .update({
        executed_at: new Date().toISOString(),
        sent_count: sentCount,
        failed_count: failedCount,
        skipped_suppressed: skippedSuppressed,
        skipped_frequency_cap: skippedFrequencyCap,
      })
      .eq("id", campaign.id);

    return NextResponse.json({
      campaign_id: campaign.id,
      requested: leads.length,
      sent: sentCount,
      failed: failedCount,
      skipped_suppressed: skippedSuppressed,
      skipped_frequency_cap: skippedFrequencyCap,
      skipped_no_email: skippedNoEmail,
      skipped_budget: skippedBudget,
      elapsed_ms: elapsed(),
      details,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/email/campaign]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/email/campaign?limit=20  → list user's campaigns
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)), 100);

    const { data, error } = await supabase
      .from("email_campaigns")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ campaigns: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

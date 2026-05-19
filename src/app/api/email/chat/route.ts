// POST /api/email/chat
//
// The /mailing chatbot endpoint. The user types what they want the
// campaign to say; this route runs the Anthropic-backed composer
// against either ONE sample lead (preview), the FULL selected set
// (per-lead drafts), or NO lead (general template). Returns the
// drafted subject + body — either a single object (general / preview)
// or a map keyed by lead_id (per_lead).

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  composePerLead,
  composeGeneralTemplate,
  type LeadForCompose,
} from "@/lib/email/compose";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

interface ChatBody {
  prompt: string;
  mode: "per_lead" | "general" | "preview";
  lead_ids?: string[];     // for per_lead + general
  preview_lead_id?: string;
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

    const body = (await req.json()) as ChatBody;
    if (!body.prompt?.trim())
      return NextResponse.json({ error: "prompt required" }, { status: 400 });
    if (!["per_lead", "general", "preview"].includes(body.mode))
      return NextResponse.json({ error: "invalid mode" }, { status: 400 });

    const service = createServiceClient();
    const cols =
      "id, primary_name, person_name, company_name, lead_type, city, country, website_url, email, phone, quality_summary, suggested_angle, superhost, review_count, estimated_property_count, has_booking_engine, has_chatbot, automation_level";

    if (body.mode === "preview") {
      if (!body.preview_lead_id)
        return NextResponse.json({ error: "preview_lead_id required" }, { status: 400 });
      const { data: lead } = await service
        .from("leads")
        .select(cols)
        .eq("id", body.preview_lead_id)
        .eq("user_id", user.id)
        .single();
      if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
      const draft = await composePerLead(body.prompt.trim(), lead as LeadForCompose);
      return NextResponse.json({ mode: "preview", draft });
    }

    if (!Array.isArray(body.lead_ids) || body.lead_ids.length === 0)
      return NextResponse.json({ error: "lead_ids required" }, { status: 400 });

    // Cap chatbot work so we don't blow Anthropic budget on a 200-lead set
    const cap = body.mode === "per_lead" ? 30 : 8;
    const ids = body.lead_ids.slice(0, cap);

    const { data: leads, error: leadsErr } = await service
      .from("leads")
      .select(cols)
      .eq("user_id", user.id)
      .in("id", ids);
    if (leadsErr || !leads)
      return NextResponse.json({ error: leadsErr?.message ?? "Lead lookup failed" }, { status: 500 });

    if (body.mode === "general") {
      const draft = await composeGeneralTemplate(body.prompt.trim(), leads as LeadForCompose[]);
      return NextResponse.json({ mode: "general", draft, audience_size: body.lead_ids.length });
    }

    // per_lead — compose for each lead, sequentially to keep token bursts low
    const drafts: Record<string, { subject: string; body: string }> = {};
    const errors: Array<{ lead_id: string; error: string }> = [];
    for (const lead of leads) {
      try {
        const d = await composePerLead(body.prompt.trim(), lead as LeadForCompose);
        drafts[lead.id] = d;
      } catch (err) {
        errors.push({
          lead_id: lead.id,
          error: err instanceof Error ? err.message : "compose failed",
        });
      }
    }

    return NextResponse.json({
      mode: "per_lead",
      drafts,
      drafted: Object.keys(drafts).length,
      requested: ids.length,
      truncated: body.lead_ids.length > cap,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/email/chat]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

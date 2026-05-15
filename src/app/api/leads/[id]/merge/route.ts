// POST /api/leads/[id]/merge
// Merges one or more duplicate leads INTO the focal lead. The focal keeps
// its ID. Duplicate leads are marked status="merged" and their useful fields
// (phone/email/website if missing on focal, plus any notes) are folded in.
//
// Body: { duplicate_ids: string[], strategy?: "fill-missing" | "prefer-duplicates" }

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface LeadShape {
  id: string;
  primary_name?: string | null;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website_url?: string | null;
  whatsapp_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
  address?: string | null;
  notes?: string | null;
  source_url?: string | null;
}

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

    const body = (await req.json()) as {
      duplicate_ids: string[];
      strategy?: "fill-missing" | "prefer-duplicates";
    };
    if (!Array.isArray(body.duplicate_ids) || body.duplicate_ids.length === 0)
      return NextResponse.json({ error: "duplicate_ids required" }, { status: 400 });

    const strategy = body.strategy ?? "fill-missing";

    const { data: focal, error: focalErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (focalErr || !focal)
      return NextResponse.json({ error: "Focal lead not found" }, { status: 404 });

    const { data: duplicates, error: dupErr } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", user.id)
      .in("id", body.duplicate_ids);
    if (dupErr) return NextResponse.json({ error: dupErr.message }, { status: 500 });

    const service = createServiceClient();
    const focalLead = focal as LeadShape;
    const merged: Partial<LeadShape> = {};

    const fillable: Array<keyof LeadShape> = [
      "company_name",
      "email",
      "phone",
      "website_url",
      "whatsapp_url",
      "instagram_url",
      "facebook_url",
      "linkedin_url",
      "address",
    ];

    for (const dup of (duplicates ?? []) as LeadShape[]) {
      for (const k of fillable) {
        const focalVal = (merged[k] ?? focalLead[k]) as string | null | undefined;
        const dupVal = dup[k];
        if (strategy === "fill-missing") {
          if (!focalVal && dupVal) merged[k] = dupVal;
        } else {
          if (dupVal) merged[k] = dupVal;
        }
      }
    }

    const notesAddendum = (duplicates ?? [])
      .map((d) => `Merged from lead ${(d as LeadShape).id} (${(d as LeadShape).primary_name ?? ""})`)
      .join("\n");
    const newNotes = [focalLead.notes, notesAddendum].filter(Boolean).join("\n");

    // Apply merged fields to the focal lead
    if (Object.keys(merged).length > 0 || newNotes !== focalLead.notes) {
      const { error: updErr } = await service
        .from("leads")
        .update({ ...merged, notes: newNotes, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    // Mark duplicates as merged (status), keep them in the DB for audit
    await service
      .from("leads")
      .update({ status: "merged", updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .in("id", body.duplicate_ids);

    // Audit trail entry
    await service
      .from("lead_enrichment_events")
      .insert({
        lead_id: id,
        provider: "compliance:merge",
        status: "applied",
        error_message: `Merged ${body.duplicate_ids.length} duplicate(s): ${body.duplicate_ids.join(", ")}`,
      })
      .then(() => undefined)
      .then(undefined, () => undefined);

    return NextResponse.json({
      merged_into: id,
      duplicates_merged: body.duplicate_ids.length,
      fields_filled: Object.keys(merged),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/[id]/merge]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

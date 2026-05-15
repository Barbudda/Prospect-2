// POST /api/leads/purge-junk
// Walks the user's leads, applies the quality gate, and deletes (or marks)
// the junk. Returns counts + samples of what was caught.
//
// Body: { dry_run?: boolean, limit?: number }
// Default: dry_run=false, limit=2000 (covers normal portfolios).

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { gradeLead, type LeadForQualityGate, type QualityVerdict } from "@/lib/engines/lead-quality-gate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface PurgeRow extends LeadForQualityGate {
  id: string;
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

    const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; limit?: number };
    const dryRun = body.dry_run === true;
    const limit = Math.min(Math.max(1, body.limit ?? 2000), 5000);

    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, primary_name, company_name, lead_type, source_url, source_type, website_url, phone, email, city")
      .eq("user_id", user.id)
      .neq("status", "draft")
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const samples: Array<{
      id: string;
      name: string;
      reasons: string[];
      category?: QualityVerdict["category"];
    }> = [];
    const toDelete: string[] = [];
    let scanned = 0;

    for (const lead of (leads ?? []) as PurgeRow[]) {
      scanned++;
      const verdict = gradeLead(lead);
      if (verdict.keep) continue;
      toDelete.push(lead.id);
      if (samples.length < 50) {
        samples.push({
          id: lead.id,
          name: lead.primary_name ?? "(unnamed)",
          reasons: verdict.reasons,
          category: verdict.category,
        });
      }
    }

    let deleted = 0;
    if (!dryRun && toDelete.length > 0) {
      const service = createServiceClient();
      const { error: delErr } = await service
        .from("leads")
        .delete()
        .eq("user_id", user.id)
        .in("id", toDelete);
      if (!delErr) deleted = toDelete.length;
    }

    return NextResponse.json({
      scanned,
      junk_count: toDelete.length,
      deleted,
      dry_run: dryRun,
      samples,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/purge-junk]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

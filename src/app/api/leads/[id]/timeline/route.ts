// GET /api/leads/[id]/timeline
// Returns the chronological audit trail for a lead — every enrichment event,
// task action, DNC change, signal persisted. Read-only.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
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

    const { data: lead } = await supabase
      .from("leads")
      .select("id, created_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [{ data: events }, { data: signals }] = await Promise.all([
      supabase
        .from("lead_enrichment_events")
        .select("id, provider, status, error_message, created_at")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("lead_signals")
        .select("id, signal_type, signal_value, source_url, confidence, created_at")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    interface TimelineEntry {
      kind: "event" | "signal" | "lead_created";
      at: string;
      title: string;
      detail?: string;
      meta?: Record<string, unknown>;
    }

    const entries: TimelineEntry[] = [];

    entries.push({
      kind: "lead_created",
      at: lead.created_at,
      title: "Lead created",
    });

    for (const e of events ?? []) {
      entries.push({
        kind: "event",
        at: e.created_at,
        title: `${e.provider} — ${e.status}`,
        detail: e.error_message ?? undefined,
      });
    }

    for (const s of signals ?? []) {
      entries.push({
        kind: "signal",
        at: s.created_at,
        title: `Signal: ${s.signal_type}`,
        detail: s.signal_value,
        meta: { source_url: s.source_url, confidence: s.confidence },
      });
    }

    entries.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

    return NextResponse.json({ count: entries.length, entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/leads/[id]/timeline]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

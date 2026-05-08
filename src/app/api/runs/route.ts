import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const offset = (page - 1) * limit;

    const { data: runs, error, count } = await supabase
      .from("search_runs")
      .select("id, city, country, target_type, status, progress, requested_leads, stats_json, error_message, created_at, started_at, finished_at", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Fetch lead counts for each run in one query.
    // For active runs, include draft leads so the progress page shows live count.
    // For finished runs, exclude drafts (they were replaced at completion).
    const runIds = (runs ?? []).map((r) => r.id);
    const activeStatuses = ["queued", "running", "collecting_sources", "extracting_contacts", "enriching", "deduplicating", "scoring"];
    const activeRunIds = (runs ?? []).filter((r) => activeStatuses.includes(r.status)).map((r) => r.id);
    const finishedRunIds = (runs ?? []).filter((r) => !activeStatuses.includes(r.status)).map((r) => r.id);

    let leadCounts: Record<string, number> = {};
    if (runIds.length > 0) {
      // For active runs: count all leads including drafts (live progress)
      if (activeRunIds.length > 0) {
        const { data: activeCounts } = await supabase
          .from("leads")
          .select("run_id")
          .eq("user_id", user.id)
          .in("run_id", activeRunIds);
        for (const row of activeCounts ?? []) {
          leadCounts[row.run_id] = (leadCounts[row.run_id] ?? 0) + 1;
        }
      }
      // For finished runs: exclude drafts
      if (finishedRunIds.length > 0) {
        const { data: finishedCounts } = await supabase
          .from("leads")
          .select("run_id")
          .eq("user_id", user.id)
          .neq("status", "draft")
          .in("run_id", finishedRunIds);
        for (const row of finishedCounts ?? []) {
          leadCounts[row.run_id] = (leadCounts[row.run_id] ?? 0) + 1;
        }
      }
    }

    const enriched = (runs ?? []).map((r) => ({
      ...r,
      lead_count: leadCounts[r.id] ?? 0,
    }));

    return NextResponse.json({ runs: enriched, total: count ?? 0 });
  } catch (err) {
    console.error("[runs] Unhandled error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

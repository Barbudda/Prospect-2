import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runSearchOrchestrator } from "@/lib/engines/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: runId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: run, error } = await supabase
      .from("search_runs")
      .select("*")
      .eq("id", runId)
      .eq("user_id", user.id)
      .single();

    if (error || !run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (!["failed", "cancelled"].includes(run.status)) {
      return NextResponse.json({ error: "Only failed or cancelled runs can be retried" }, { status: 409 });
    }

    const serviceSupabase = createServiceClient();

    // Reset run state to queued
    await serviceSupabase
      .from("search_runs")
      .update({
        status: "queued",
        progress: 0,
        error_message: null,
        started_at: null,
        finished_at: null,
        stats_json: null,
      })
      .eq("id", runId);

    // Clear old logs
    await serviceSupabase.from("search_run_logs").delete().eq("run_id", runId);

    // Clear old leads from this run
    await serviceSupabase.from("leads").delete().eq("run_id", runId).eq("user_id", user.id);

    await serviceSupabase.from("search_run_logs").insert({
      run_id: runId,
      level: "info",
      message: "Run retried by user.",
    });

    const requestedLeads = run.requested_leads ?? 50;
    const maxSearchQueries = requestedLeads <= 25 ? 8
      : requestedLeads <= 50 ? 12
      : requestedLeads <= 100 ? 16
      : 20;
    const maxWebsitesToCrawl = requestedLeads <= 25 ? 20
      : requestedLeads <= 50 ? 40
      : requestedLeads <= 100 ? 60
      : 80;

    after(
      runSearchOrchestrator(
        runId,
        user.id,
        run.city,
        run.country,
        run.target_type ?? "all",
        {
          maxLeadsReturned: requestedLeads,
          maxSearchQueries,
          maxWebsitesToCrawl,
          ...(run.config_json ?? {}),
        }
      ).catch((err) => {
        console.error(`Retry run ${runId} failed:`, err);
      })
    );

    return NextResponse.json({ retried: true, run_id: runId });
  } catch (err) {
    console.error("[runs/retry] Unhandled error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

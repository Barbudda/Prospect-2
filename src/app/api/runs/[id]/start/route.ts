import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runSearchOrchestrator } from "@/lib/engines/orchestrator";

export const dynamic = "force-dynamic";

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

    if (run.status !== "queued") {
      return NextResponse.json({ error: "Run is not in queued state" }, { status: 409 });
    }

    runSearchOrchestrator(
      runId,
      user.id,
      run.city,
      run.country,
      run.target_type ?? "all",
      {
        maxLeadsReturned: run.requested_leads ?? 50,
        ...(run.config_json ?? {}),
      }
    ).catch((err) => {
      console.error(`Run ${runId} failed:`, err);
    });

    return NextResponse.json({ started: true, run_id: runId });
  } catch (err) {
    console.error("[runs/start] Unhandled error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

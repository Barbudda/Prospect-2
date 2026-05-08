import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
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

  const { data: logs } = await supabase
    .from("search_run_logs")
    .select("level, message, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: false })
    .limit(20);

  const { count: leadCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("user_id", user.id);

  return NextResponse.json({
    id: run.id,
    city: run.city,
    country: run.country,
    target_type: run.target_type,
    status: run.status,
    progress: run.progress ?? 0,
    stats: run.stats_json ?? {
      sources_found: 0,
      websites_crawled: 0,
      leads_extracted: 0,
      leads_deduplicated: 0,
      errors: 0,
      enriched: 0,
    },
    recent_logs: (logs ?? []).reverse(),
    lead_count: leadCount ?? 0,
    error_message: run.error_message ?? null,
  });
  } catch (err) {
    console.error("[runs/status] Unhandled error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

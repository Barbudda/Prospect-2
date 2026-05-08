import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { count: savedLeads } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("user_id", user.id);

  const { error } = await supabase
    .from("search_runs")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("search_run_logs").insert({
    run_id: runId,
    level: "info",
    message: `Run cancelled by user. ${savedLeads ?? 0} leads were saved before cancellation.`,
  });

  return NextResponse.json({ cancelled: true });
}

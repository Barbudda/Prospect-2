import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [
      leadsRes,
      runsRes,
      emailsRes,
      hotLeadsRes,
      contactedRes,
      outreachGeneratedRes,
    ] = await Promise.all([
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .neq("status", "draft"),
      supabase
        .from("search_runs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "completed"),
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .not("email", "is", null)
        .neq("status", "draft"),
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("score_label", "Hot")
        .neq("status", "draft"),
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("outreach_status", ["contacted", "replied", "converted"])
        .neq("status", "draft"),
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .not("outreach_email", "is", null)
        .neq("status", "draft"),
    ]);

    return NextResponse.json({
      total_leads: leadsRes.count ?? 0,
      completed_runs: runsRes.count ?? 0,
      leads_with_email: emailsRes.count ?? 0,
      hot_leads: hotLeadsRes.count ?? 0,
      leads_contacted: contactedRes.count ?? 0,
      outreach_generated: outreachGeneratedRes.count ?? 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}

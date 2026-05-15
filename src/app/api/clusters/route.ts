// Returns hidden-operator clusters detected across the user's leads.
// No new external API calls — pure analysis over data we already have.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  detectOperatorClusters,
  type LeadForClustering,
} from "@/lib/engines/operator-clusterer";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, primary_name, company_name, city, score, phone, email, website_url, source_url, lead_type"
      )
      .eq("user_id", user.id)
      .neq("status", "draft")
      .limit(2000);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    const leads = (data ?? []) as LeadForClustering[];
    const clusters = detectOperatorClusters(leads);

    return NextResponse.json({
      total_leads_analysed: leads.length,
      clusters_found: clusters.length,
      // Cap response size — top 100 clusters is plenty
      clusters: clusters.slice(0, 100),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/clusters]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

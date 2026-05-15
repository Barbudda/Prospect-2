// GET /api/leads/[id]/relationships
// Returns the graph of related leads (shared phone / domain / SIRET / address)
// for a focal lead. Computed on-the-fly from the user's lead list.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeRelations, type GraphLead } from "@/lib/engines/entity-graph";

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

    const { data: focal, error: focalErr } = await supabase
      .from("leads")
      .select(
        "id, primary_name, company_name, city, address, email, phone, website_url, score, lead_type"
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (focalErr || !focal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: peers, error: peersErr } = await supabase
      .from("leads")
      .select(
        "id, primary_name, company_name, city, address, email, phone, website_url, score, lead_type"
      )
      .eq("user_id", user.id)
      .neq("status", "draft")
      .limit(3000);
    if (peersErr)
      return NextResponse.json({ error: peersErr.message }, { status: 500 });

    const edges = computeRelations(focal as GraphLead, (peers ?? []) as GraphLead[]);

    return NextResponse.json({ focal_id: id, edge_count: edges.length, edges });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/leads/[id]/relationships]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

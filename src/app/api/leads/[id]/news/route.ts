// POST /api/leads/[id]/news
// Scans French press domains for mentions of the operator's name + city.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { scanPressMentions } from "@/lib/engines/news-scanner";
import { persistSignalsForLead } from "@/lib/engines/signal-persister";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
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

    const { data: lead, error } = await supabase
      .from("leads")
      .select("primary_name, company_name, city")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (error || !lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const queryName = lead.company_name ?? lead.primary_name;
    const mentions = await scanPressMentions(queryName, lead.city);

    if (mentions.length > 0) {
      const service = createServiceClient();
      await persistSignalsForLead(service, id, { press_mentions: mentions });
    }

    return NextResponse.json({ count: mentions.length, mentions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/[id]/news]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

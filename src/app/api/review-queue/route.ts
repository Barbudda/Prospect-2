// GET /api/review-queue
// Returns leads needing human verification, sorted by priority.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildReviewQueue, type ReviewableLead } from "@/lib/engines/review-queue";

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
        "id, primary_name, company_name, lead_type, city, email, phone, website_url, score, reconstructed, reconstruction_confidence, confidence, source_url, source_type, status"
      )
      .eq("user_id", user.id)
      .neq("status", "draft")
      .neq("outreach_status", "opted_out")
      .neq("outreach_status", "unsubscribed")
      .limit(3000);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    const queue = buildReviewQueue((data ?? []) as ReviewableLead[]);

    return NextResponse.json({
      total_scanned: data?.length ?? 0,
      items_needing_review: queue.length,
      queue: queue.slice(0, 200),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/review-queue]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

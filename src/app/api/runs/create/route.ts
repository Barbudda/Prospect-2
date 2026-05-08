import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { city, country, targetType, requestedLeads, config } = body as {
      city?: string;
      country?: string;
      targetType?: string;
      requestedLeads?: number;
      config?: Record<string, unknown>;
    };

    if (!city || !country) {
      return NextResponse.json({ error: "city and country are required" }, { status: 400 });
    }

    const name = `${city}, ${country} — ${new Date().toLocaleDateString("fr-FR")}`;

    const { data, error } = await supabase
      .from("search_runs")
      .insert({
        user_id: user.id,
        name,
        city,
        country,
        target_type: targetType ?? "all",
        requested_leads: requestedLeads ?? 50,
        status: "queued",
        progress: 0,
        config_json: config ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[runs/create] Supabase insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ run_id: data.id });
  } catch (err) {
    console.error("[runs/create] Unhandled error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

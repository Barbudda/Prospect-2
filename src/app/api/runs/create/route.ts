import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { city, country, targetType, requestedLeads, config } = body;

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ run_id: data.id });
}

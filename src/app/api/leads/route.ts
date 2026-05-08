import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const run_id = sp.get("run");
    const score_label = sp.get("score_label");
    const lead_type = sp.get("lead_type");
    const has_email = sp.get("has_email");
    const has_phone = sp.get("has_phone");
    const has_website = sp.get("has_website");
    const outreach_status = sp.get("outreach_status");
    const city = sp.get("city");
    const search = sp.get("q");
    const page = parseInt(sp.get("page") ?? "1", 10);
    const limit = Math.min(parseInt(sp.get("limit") ?? "50", 10), 200);
    const offset = (page - 1) * limit;

    let query = supabase
      .from("leads")
      .select("id, primary_name, lead_type, city, country, email, phone, website_url, source_url, score, score_label, outreach_status, outreach_email, run_id", { count: "exact" })
      .eq("user_id", user.id)
      .neq("status", "draft")
      .order("score", { ascending: false })
      .range(offset, offset + limit - 1);

    if (run_id) query = query.eq("run_id", run_id);
    if (score_label) query = query.eq("score_label", score_label);
    if (lead_type) query = query.eq("lead_type", lead_type);
    if (has_email === "true") query = query.not("email", "is", null);
    if (has_phone === "true") query = query.not("phone", "is", null);
    if (has_website === "true") query = query.not("website_url", "is", null);
    if (outreach_status) query = query.eq("outreach_status", outreach_status);
    if (city) query = query.ilike("city", `%${city}%`);
    if (search) query = query.or(`primary_name.ilike.%${search}%,email.ilike.%${search}%,company_name.ilike.%${search}%`);

    const { data, error, count } = await query;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ leads: data ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ids, outreach_status, notes } = await req.json();
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (outreach_status) updates.outreach_status = outreach_status;
  if (notes !== undefined) updates.notes = notes;

  const { error } = await supabase
    .from("leads")
    .update(updates)
    .in("id", ids)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ updated: true });
}

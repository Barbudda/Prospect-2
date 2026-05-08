import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CSV_COLUMNS = [
  "score",
  "score_label",
  "primary_name",
  "company_name",
  "person_name",
  "lead_type",
  "city",
  "country",
  "email",
  "phone",
  "whatsapp_url",
  "website_url",
  "contact_form_url",
  "instagram_url",
  "linkedin_url",
  "facebook_url",
  "google_maps_url",
  "source_url",
  "source_type",
  "outreach_status",
  "suggested_angle",
  "quality_summary",
  "outreach_email",
  "notes",
];

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCSV(lead: Record<string, unknown>): string {
  return CSV_COLUMNS.map((col) => escapeCSV(lead[col])).join(",");
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const run_id = sp.get("run");
  const ids = sp.get("ids");

  let query = supabase
    .from("leads")
    .select(CSV_COLUMNS.join(","))
    .eq("user_id", user.id)
    .neq("status", "draft")
    .order("score", { ascending: false });

  if (run_id) query = query.eq("run_id", run_id);
  if (ids) query = query.in("id", ids.split(","));

  const { data: leads, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!leads || leads.length === 0) {
    return NextResponse.json({ error: "No leads to export" }, { status: 404 });
  }

  const header = CSV_COLUMNS.join(",");
  const rows = leads.map((l) => rowToCSV(l as unknown as Record<string, unknown>));
  const csv = [header, ...rows].join("\n");

  const filename = run_id
    ? `leads-run-${run_id.slice(0, 8)}.csv`
    : `leads-export-${Date.now()}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

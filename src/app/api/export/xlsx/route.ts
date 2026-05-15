// Excel (.xlsx) export of leads. Mirrors the CSV export auth + filters.
// Optional ?run=<run_id> to scope to a single run.
// Optional ?ids=<csv-of-ids> to scope to a selection.
// Optional ?only_valid_phone=1 to include only rows where validateFrenchPhone passes.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateEmail, validateFrenchPhone } from "@/lib/utils/contact-validator";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Columns shown in the spreadsheet, in display order. The numeric/boolean
// columns are emitted as native types so Excel sorts and filters them properly.
const COLUMNS: Array<{ key: string; label: string }> = [
  { key: "score", label: "Score" },
  { key: "score_label", label: "Tier" },
  { key: "primary_name", label: "Name" },
  { key: "company_name", label: "Company" },
  { key: "person_name", label: "Contact person" },
  { key: "lead_type", label: "Type" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "address", label: "Address" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "whatsapp_url", label: "WhatsApp" },
  { key: "website_url", label: "Website" },
  { key: "instagram_url", label: "Instagram" },
  { key: "linkedin_url", label: "LinkedIn" },
  { key: "facebook_url", label: "Facebook" },
  { key: "contact_form_url", label: "Contact form" },
  { key: "google_maps_url", label: "Google Maps" },
  { key: "source_url", label: "Source URL" },
  { key: "source_type", label: "Source type" },
  { key: "superhost", label: "Superhost" },
  { key: "review_count", label: "Reviews" },
  { key: "listing_title", label: "Listing title" },
  { key: "reconstructed", label: "Visually reconstructed" },
  { key: "reconstruction_confidence", label: "Visual confidence" },
  { key: "exclusivity_score", label: "Exclusivity" },
  { key: "opportunity_score", label: "Opportunity" },
  { key: "intent_score", label: "Intent" },
  { key: "automation_level", label: "Automation" },
  { key: "outreach_status", label: "Outreach status" },
  { key: "suggested_angle", label: "Suggested angle" },
  { key: "quality_summary", label: "Summary" },
  { key: "created_at", label: "Created" },
];

type LeadRow = Record<string, unknown> & {
  phone?: string | null;
  email?: string | null;
};

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const run_id = sp.get("run");
  const ids = sp.get("ids");
  const onlyValidPhone = sp.get("only_valid_phone") === "1";
  const onlyValidContact = sp.get("only_valid_contact") === "1";

  let query = supabase
    .from("leads")
    .select(COLUMNS.map((c) => c.key).join(","))
    .eq("user_id", user.id)
    .neq("status", "draft")
    .order("score", { ascending: false });

  if (run_id) query = query.eq("run_id", run_id);
  if (ids) query = query.in("id", ids.split(","));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return NextResponse.json({ error: "No leads to export" }, { status: 404 });

  // Defensive re-validation at export time so Excel never shows a garbage value
  // even if a row slipped past the extractor's check somehow.
  const leads: LeadRow[] = (data as unknown as LeadRow[]).map((l) => {
    const cleanedPhone = l.phone ? validateFrenchPhone(l.phone) : null;
    const cleanedEmail = l.email ? validateEmail(l.email) : null;
    return {
      ...l,
      phone: cleanedPhone?.valid ? cleanedPhone.cleaned ?? l.phone : null,
      email: cleanedEmail?.valid ? cleanedEmail.cleaned ?? l.email : null,
    };
  });

  const filtered = leads.filter((l) => {
    if (onlyValidPhone && !l.phone) return false;
    if (onlyValidContact && !l.phone && !l.email) return false;
    return true;
  });

  if (filtered.length === 0)
    return NextResponse.json({ error: "No leads match the filter" }, { status: 404 });

  // Build the worksheet — first row is the human-readable header
  const aoa: unknown[][] = [
    COLUMNS.map((c) => c.label),
    ...filtered.map((row) =>
      COLUMNS.map((c) => {
        const v = row[c.key];
        if (v === null || v === undefined) return "";
        return v;
      })
    ),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Auto-size columns based on content width (clamped to sensible bounds)
  ws["!cols"] = COLUMNS.map((c, i) => {
    let max = c.label.length;
    for (const row of aoa.slice(1)) {
      const cell = row[i];
      const len = cell == null ? 0 : String(cell).length;
      if (len > max) max = len;
    }
    return { wch: Math.min(Math.max(max + 2, 10), 60) };
  });

  // Freeze the header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filename = run_id
    ? `leads-run-${run_id.slice(0, 8)}.xlsx`
    : `leads-export-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
    },
  });
}

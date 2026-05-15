// GET /api/leads/[id]/contact-paths
// Returns all lawful contact paths discovered for the lead, sorted by
// recommended order (1 = best, 9 = last resort).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findContactPaths, type LeadForContactPaths } from "@/lib/engines/contact-path-finder";

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

    const { data: lead, error } = await supabase
      .from("leads")
      .select(
        "primary_name, company_name, city, country, email, phone, whatsapp_url, contact_form_url, website_url, linkedin_url, instagram_url, facebook_url, google_maps_url, address, lead_type, source_type"
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const paths = findContactPaths(lead as LeadForContactPaths);
    return NextResponse.json({ count: paths.length, paths });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[GET /api/leads/[id]/contact-paths]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

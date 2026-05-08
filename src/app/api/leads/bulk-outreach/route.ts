import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWebsiteContent, generateOutreachEmail } from "@/lib/rag/outreach-generator";

export const dynamic = "force-dynamic";

// Generates outreach emails for up to 10 leads at once.
// Returns per-lead results so the UI can show partial success.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids array required" }, { status: 400 });
    }
    if (ids.length > 10) {
      return NextResponse.json({ error: "Maximum 10 leads per batch" }, { status: 400 });
    }

    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, primary_name, lead_type, city, country, website_url, email, phone, suggested_angle, quality_summary, website_content")
      .in("id", ids)
      .eq("user_id", user.id);

    if (leadsError || !leads) {
      return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    for (const lead of leads) {
      try {
        let websiteContent: string | null = lead.website_content ?? null;
        if (!websiteContent && lead.website_url) {
          websiteContent = await fetchWebsiteContent(lead.website_url);
          if (websiteContent) {
            await supabase
              .from("leads")
              .update({ website_content: websiteContent })
              .eq("id", lead.id);
          }
        }

        const email = await generateOutreachEmail({
          primary_name: lead.primary_name,
          lead_type: lead.lead_type,
          city: lead.city,
          country: lead.country,
          website_url: lead.website_url,
          email: lead.email,
          phone: lead.phone,
          suggested_angle: lead.suggested_angle,
          quality_summary: lead.quality_summary,
          website_content: websiteContent,
        });

        await supabase
          .from("leads")
          .update({ outreach_email: email, outreach_generated_at: new Date().toISOString() })
          .eq("id", lead.id);

        results.push({ id: lead.id, ok: true });
      } catch (err) {
        results.push({
          id: lead.id,
          ok: false,
          error: err instanceof Error ? err.message : "Failed",
        });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    return NextResponse.json({ results, succeeded, total: leads.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

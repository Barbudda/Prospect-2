import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWebsiteContent, generateOutreachEmail } from "@/lib/rag/outreach-generator";
import { checkPerLeadCap } from "@/lib/utils/outreach-cap";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leadId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("user_id", user.id)
      .single();

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Frequency cap — refuse to regenerate within 90 days unless ?force=1.
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    if (!force) {
      const decision = checkPerLeadCap(lead.outreach_generated_at);
      if (!decision.allowed) {
        return NextResponse.json(
          { error: decision.reason, retry_after: decision.retry_after, frequency_capped: true },
          { status: 429 }
        );
      }
    }

    // Crawl website if we don't have content yet
    let websiteContent: string | null = lead.website_content ?? null;
    if (!websiteContent && lead.website_url) {
      websiteContent = await fetchWebsiteContent(lead.website_url);
      if (websiteContent) {
        await supabase
          .from("leads")
          .update({ website_content: websiteContent })
          .eq("id", leadId);
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

    // Save generated email
    await supabase
      .from("leads")
      .update({ outreach_email: email, outreach_generated_at: new Date().toISOString() })
      .eq("id", leadId);

    return NextResponse.json({ email });
  } catch (err) {
    console.error("[leads/outreach] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate outreach" },
      { status: 500 }
    );
  }
}

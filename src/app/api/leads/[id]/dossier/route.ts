// POST /api/leads/[id]/dossier
// Builds the lead dossier (#15 from the brief): summary, why-it-matters,
// scores, weird signals, contact paths, evidence trail, pain points, suggested
// offer, multi-channel outreach drafts, compliance notes.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { generateLeadDossier, type DossierInput } from "@/lib/engines/lead-dossier";
import { buildComplianceSummary } from "@/lib/utils/compliance";
import { detectOperatorClusters, type LeadForClustering } from "@/lib/engines/operator-clusterer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const service = createServiceClient();
    const compliance = await buildComplianceSummary(service, user.id, lead);

    // Compute cluster_size on the fly so the dossier can use it
    let clusterSize = 1;
    try {
      const { data: peers } = await service
        .from("leads")
        .select("id, primary_name, company_name, city, score, phone, email, website_url, source_url, lead_type")
        .eq("user_id", user.id)
        .limit(2000);
      const clusters = detectOperatorClusters((peers ?? []) as LeadForClustering[]);
      for (const c of clusters) {
        if (c.lead_ids.includes(id)) {
          clusterSize = Math.max(clusterSize, c.lead_count);
        }
      }
    } catch {
      // non-fatal
    }

    const input: DossierInput = {
      primary_name: lead.primary_name,
      company_name: lead.company_name,
      person_name: lead.person_name,
      lead_type: lead.lead_type,
      city: lead.city,
      country: lead.country,
      address: lead.address,
      website_url: lead.website_url,
      email: lead.email,
      phone: lead.phone,
      whatsapp_url: lead.whatsapp_url,
      contact_form_url: lead.contact_form_url,
      instagram_url: lead.instagram_url,
      facebook_url: lead.facebook_url,
      linkedin_url: lead.linkedin_url,
      google_maps_url: lead.google_maps_url,
      source_url: lead.source_url,
      source_type: lead.source_type,
      score: lead.score,
      score_label: lead.score_label,
      quality_summary: lead.quality_summary,
      superhost: lead.superhost,
      review_count: lead.review_count,
      listing_title: lead.listing_title,
      reconstructed: lead.reconstructed,
      reconstruction_confidence: lead.reconstruction_confidence,
      exclusivity_score: lead.exclusivity_score,
      opportunity_score: lead.opportunity_score,
      has_booking_engine: lead.has_booking_engine,
      has_chatbot: lead.has_chatbot,
      has_faq: lead.has_faq,
      automation_level: lead.automation_level,
      has_owner_acquisition_page: lead.has_owner_acquisition_page,
      estimated_property_count: lead.estimated_property_count,
      geo_signals: lead.geo_signals,
      cluster_size: clusterSize,
    };

    const dossier = await generateLeadDossier(input, compliance.notes);

    // Audit trail
    await service
      .from("lead_enrichment_events")
      .insert({
        lead_id: id,
        provider: "lead_dossier",
        status: "success",
      })
      .then(() => undefined)
      .then(undefined, () => undefined);

    return NextResponse.json({ dossier, compliance });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/[id]/dossier]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

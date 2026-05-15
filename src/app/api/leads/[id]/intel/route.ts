// POST /api/leads/[id]/intel
// One-shot lead-intelligence collector. Runs in parallel:
//   1. weird-signal scan
//   2. contact-path enumeration
//   3. operator-cluster lookup (size + peers)
//   4. relationship graph (shared phone / domain / address / brand)
//   5. review-intelligence scan
//   6. DVF property-transaction lookup (if GPS available from visual recon)
//   7. compliance summary (lawful basis, retention, DNC check)
//
// Body: optional { include_dossier: true } also runs the Mammouth dossier
// generator. Without it, you get the raw signals — cheap and fast.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  scanLeadForWeirdSignals,
  severityRank,
  type LeadForSignals,
} from "@/lib/engines/weird-signal-scanner";
import { findContactPaths, type LeadForContactPaths } from "@/lib/engines/contact-path-finder";
import { computeRelations, type GraphLead } from "@/lib/engines/entity-graph";
import { detectOperatorClusters, type LeadForClustering } from "@/lib/engines/operator-clusterer";
import { scanReviewIntelligence, type LeadForReviewIntel } from "@/lib/engines/review-intelligence";
import { classifyLeadAsPartner, type LeadForPartner } from "@/lib/engines/partner-classifier";
import * as DVF from "@/lib/providers/dvf";
import * as Sitadel from "@/lib/providers/sitadel";
import { buildComplianceSummary } from "@/lib/utils/compliance";
import { generateLeadDossier, type DossierInput } from "@/lib/engines/lead-dossier";
import { persistSignalsForLead } from "@/lib/engines/signal-persister";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface GeoSignalsBlob {
  detected_location?: { latitude?: number; longitude?: number; address?: string };
  exterior_signals?: {
    permit_info?: { beneficiary_name?: string; permit_number?: string };
  };
}

function parseGeoSignals(raw: unknown): GeoSignalsBlob {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as GeoSignalsBlob;
    } catch {
      return {};
    }
  }
  return raw as GeoSignalsBlob;
}

export async function POST(
  req: NextRequest,
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

    const body = (await req.json().catch(() => ({}))) as { include_dossier?: boolean };

    const { data: lead, error } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (error || !lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const service = createServiceClient();
    const geo = parseGeoSignals(lead.geo_signals);
    const gps = geo.detected_location;
    const permitName = geo.exterior_signals?.permit_info?.beneficiary_name;
    // Extract last 5 digits of postal code → INSEE commune lookup proxy.
    const inseeFromAddress = lead.address?.match(/\b(\d{5})\b/)?.[1];

    // Parallel collection
    const [
      weirdSignals,
      contactPaths,
      reviewSignals,
      partnerClassification,
      complianceSummary,
      peerLeads,
      dvf,
      sitadel,
    ] = await Promise.all([
      Promise.resolve(scanLeadForWeirdSignals(lead as LeadForSignals).sort(
        (a, b) => severityRank(b) - severityRank(a)
      )),
      Promise.resolve(findContactPaths(lead as LeadForContactPaths)),
      Promise.resolve(scanReviewIntelligence(lead as LeadForReviewIntel)),
      Promise.resolve(classifyLeadAsPartner(lead as LeadForPartner)),
      buildComplianceSummary(service, user.id, lead),
      service
        .from("leads")
        .select(
          "id, primary_name, company_name, city, address, score, phone, email, website_url, lead_type"
        )
        .eq("user_id", user.id)
        .neq("status", "draft")
        .limit(2000)
        .then((r) => (r.data ?? []) as GraphLead[]),
      gps?.latitude && gps?.longitude
        ? DVF.lookupByCoords(gps.latitude, gps.longitude, 30)
        : Promise.resolve(null),
      // Sit@del2 building-permit cross-reference: only run when we have BOTH
      // a permit beneficiary name from exterior OCR AND an INSEE-like commune
      // code from the address. Otherwise the lookup has nothing to match.
      permitName && inseeFromAddress
        ? Sitadel.lookupByCommune(inseeFromAddress, permitName)
        : Promise.resolve(null),
    ]);

    // Cluster + relationships derived from peerLeads
    const clusters = detectOperatorClusters(peerLeads as LeadForClustering[]);
    const ownCluster =
      clusters.find((c) => c.lead_ids.includes(id)) ?? null;
    const relations = computeRelations(lead as GraphLead, peerLeads);

    // Persist detected signals to lead_signals for the audit trail
    await persistSignalsForLead(service, id, {
      weird_signals: weirdSignals,
      review_signals: reviewSignals,
    });

    let dossier = null;
    if (body.include_dossier) {
      const dossierInput: DossierInput = {
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
        cluster_size: ownCluster?.lead_count ?? 1,
      };
      dossier = await generateLeadDossier(dossierInput, complianceSummary.notes);
    }

    return NextResponse.json({
      lead_id: id,
      weird_signals: weirdSignals,
      contact_paths: contactPaths,
      review_signals: reviewSignals,
      partner_classification: partnerClassification,
      compliance: complianceSummary,
      cluster: ownCluster,
      relationships: relations,
      dvf,
      sitadel,
      dossier,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/[id]/intel]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

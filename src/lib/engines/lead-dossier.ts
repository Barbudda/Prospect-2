// LEAD DOSSIER GENERATOR (#15 from the brief)
// Synthesises everything we know about a lead into a single structured dossier:
// summary, why-it-matters, evidence trail, opportunity scores, weird signals,
// estimated operator type, pain points, suggested offer, best contact path,
// compliance notes, and multi-channel outreach drafts.
//
// Composition only — uses existing engines (weird signals, contact paths,
// scorer-v2, compliance) plus Mammouth for the natural-language synthesis.
// No new external data fetched.

import * as Mammouth from "@/lib/providers/mammouth";
import {
  scanLeadForWeirdSignals,
  type LeadForSignals,
  type WeirdSignal,
} from "@/lib/engines/weird-signal-scanner";
import {
  findContactPaths,
  type LeadForContactPaths,
  type ContactPath,
} from "@/lib/engines/contact-path-finder";
import { scoreLeadV2, type ScoreV2Result } from "@/lib/engines/scorer-v2";

export interface DossierInput {
  // Core lead fields
  primary_name: string;
  company_name?: string | null;
  person_name?: string | null;
  lead_type: string;
  city: string;
  country: string;
  address?: string | null;
  website_url?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp_url?: string | null;
  contact_form_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
  google_maps_url?: string | null;
  source_url?: string | null;
  source_type?: string | null;
  score: number;
  score_label?: string | null;
  quality_summary?: string | null;
  // Intelligence layer
  superhost?: boolean | null;
  review_count?: number | null;
  listing_title?: string | null;
  reconstructed?: boolean | null;
  reconstruction_confidence?: number | null;
  exclusivity_score?: number | null;
  opportunity_score?: number | null;
  has_booking_engine?: boolean | null;
  has_chatbot?: boolean | null;
  has_faq?: boolean | null;
  automation_level?: "low" | "medium" | "high" | null;
  has_owner_acquisition_page?: boolean | null;
  estimated_property_count?: number | null;
  geo_signals?: unknown;
  // Optional supporting data
  cluster_size?: number;
  audit_score?: number | null;
  audit_findings?: Array<{ code: string; description: string; severity: string }>;
}

export interface OutreachDrafts {
  email_subject?: string;
  email_body?: string;
  linkedin?: string;
  contact_form?: string;
  postal?: string;
  partner_intro?: string;
}

export interface LeadDossier {
  summary: string;
  why_this_matters: string;
  estimated_operator_type: string;
  scores: ScoreV2Result;
  weird_signals: WeirdSignal[];
  contact_paths: ContactPath[];
  evidence_trail: Array<{ source: string; observation: string; confidence: string }>;
  pain_points: string[];
  suggested_offer: string;
  recommended_next_action: string;
  outreach_drafts: OutreachDrafts;
  compliance_notes: string[];
}

function leadForSignals(d: DossierInput): LeadForSignals {
  return {
    primary_name: d.primary_name,
    company_name: d.company_name,
    city: d.city,
    country: d.country,
    lead_type: d.lead_type,
    website_url: d.website_url,
    email: d.email,
    phone: d.phone,
    instagram_url: d.instagram_url,
    facebook_url: d.facebook_url,
    linkedin_url: d.linkedin_url,
    source_type: d.source_type,
    superhost: d.superhost,
    review_count: d.review_count,
    listing_title: d.listing_title,
    reconstructed: d.reconstructed,
    reconstruction_confidence: d.reconstruction_confidence,
    exclusivity_score: d.exclusivity_score,
    score: d.score,
    opportunity_score: d.opportunity_score,
    has_booking_engine: d.has_booking_engine,
    has_chatbot: d.has_chatbot,
    has_faq: d.has_faq,
    automation_level: d.automation_level,
    has_owner_acquisition_page: d.has_owner_acquisition_page,
    estimated_property_count: d.estimated_property_count,
    geo_signals: d.geo_signals,
  };
}

function leadForPaths(d: DossierInput): LeadForContactPaths {
  return {
    primary_name: d.primary_name,
    company_name: d.company_name,
    city: d.city,
    country: d.country,
    email: d.email,
    phone: d.phone,
    whatsapp_url: d.whatsapp_url,
    contact_form_url: d.contact_form_url,
    website_url: d.website_url,
    linkedin_url: d.linkedin_url,
    instagram_url: d.instagram_url,
    facebook_url: d.facebook_url,
    google_maps_url: d.google_maps_url,
    address: d.address,
    lead_type: d.lead_type,
    source_type: d.source_type,
  };
}

function buildEvidenceTrail(
  d: DossierInput,
  signals: WeirdSignal[]
): Array<{ source: string; observation: string; confidence: string }> {
  const trail: Array<{ source: string; observation: string; confidence: string }> = [];
  if (d.source_type === "visual_reconstruction" && d.reconstruction_confidence != null) {
    trail.push({
      source: "Visual reconstruction pipeline",
      observation: `Property visually reconstructed from listing photos; geographic confidence ${d.reconstruction_confidence}/100`,
      confidence: d.reconstruction_confidence >= 70 ? "high" : d.reconstruction_confidence >= 40 ? "medium" : "low",
    });
  }
  if (d.source_type === "google_maps") {
    trail.push({
      source: "Google Business Profile",
      observation: "Operator has a verified Google Business listing",
      confidence: "high",
    });
  }
  if (d.estimated_property_count && d.estimated_property_count >= 2) {
    trail.push({
      source: "Operator clustering",
      observation: `Estimated ${d.estimated_property_count} properties under this operator`,
      confidence: "medium",
    });
  }
  if (d.superhost) {
    trail.push({
      source: "Airbnb listing snippet",
      observation: "Superhost status confirmed",
      confidence: "high",
    });
  }
  if (typeof d.audit_score === "number") {
    trail.push({
      source: "Website auditor",
      observation: `Public website audit score ${d.audit_score}/100`,
      confidence: "high",
    });
  }
  for (const s of signals.slice(0, 5)) {
    trail.push({
      source: "Weird signal scanner",
      observation: s.description,
      confidence: s.severity === "high" ? "high" : s.severity === "medium" ? "medium" : "low",
    });
  }
  return trail;
}

function fallbackPainPoints(d: DossierInput, signals: WeirdSignal[]): string[] {
  const pains = new Set<string>();
  for (const s of signals) {
    if (s.code === "luxury_no_website") pains.add("Paying full OTA commission on a high-ticket property");
    if (s.code === "luxury_no_direct_booking") pains.add("No direct booking funnel");
    if (s.code === "social_only_no_website") pains.add("Invisible to Google search");
    if (s.code === "superhost_no_website") pains.add("100% dependence on a single platform");
    if (s.code === "many_reviews_listing_only") pains.add("Strong reputation, zero digital leverage");
    if (s.code === "website_low_automation") pains.add("Heavy manual operation");
    if (s.code === "booking_no_faq") pains.add("Pre-booking support load");
    if (s.code === "fr_market_en_only") pains.add("Missing French domestic demand");
  }
  if ((d.audit_score ?? 100) < 50) pains.add("Website conversion gap (slow, missing booking engine, etc.)");
  if (d.estimated_property_count && d.estimated_property_count >= 3)
    pains.add("Manual coordination across multiple listings");
  return Array.from(pains);
}

function fallbackOffer(signals: WeirdSignal[]): string {
  for (const s of signals) {
    if (s.code === "luxury_no_website") return "15-minute direct-booking audit + OTA-commission benchmark";
    if (s.code === "superhost_no_website") return "Direct-booking funnel for Superhosts (free conversion estimate)";
    if (s.code === "multi_property_operator") return "Portfolio-level PMS + channel manager demo";
    if (s.code === "website_low_automation") return "Free website conversion audit";
    if (s.code === "booking_no_faq") return "Free guest-message template pack";
    if (s.code === "fr_market_en_only") return "French localisation audit";
  }
  return "30-minute discovery call to identify the biggest revenue leak";
}

// ─── Mammouth synthesis ──────────────────────────────────────────────────────
// Asks Mammouth to write a tight summary + why-it-matters + outreach drafts
// from the structured signals. Falls back to deterministic strings if
// Mammouth isn't configured.

async function synthesise(
  d: DossierInput,
  signals: WeirdSignal[],
  scores: ScoreV2Result,
  paths: ContactPath[]
): Promise<{
  summary: string;
  why_this_matters: string;
  estimated_operator_type: string;
  outreach_drafts: OutreachDrafts;
}> {
  const fallbackSummary = `${d.primary_name} in ${d.city} — ${d.lead_type}. Score ${d.score}/100. ${scores.reasoning_summary}`;
  const fallbackWhy = signals.length
    ? `${signals.length} opportunity signal(s) detected. Best fit: ${scores.suggested_service_fit.join(", ")}.`
    : "Standard prospect — needs discovery call.";

  if (!Mammouth.isConfigured()) {
    return {
      summary: fallbackSummary,
      why_this_matters: fallbackWhy,
      estimated_operator_type: d.lead_type,
      outreach_drafts: { email_subject: `Quick question about ${d.primary_name}` },
    };
  }

  try {
    const result = await Mammouth.reason<{
      summary: string;
      why_this_matters: string;
      estimated_operator_type: string;
      email_subject: string;
      email_body: string;
      linkedin: string;
      contact_form: string;
      postal: string;
      partner_intro: string;
    }>(
      "You are a B2B lead-intelligence analyst writing a one-page dossier for a sales team selling services to short-term rental operators.",
      `Write a structured dossier for this lead. Be evidence-based, never speculative.

LEAD
- Name: ${d.primary_name}
- Company: ${d.company_name ?? "—"}
- Type: ${d.lead_type}
- Location: ${d.city}, ${d.country}
- Website: ${d.website_url ?? "—"}
- Has phone: ${d.phone ? "yes" : "no"} | Has email: ${d.email ? "yes" : "no"}
- Superhost: ${d.superhost ? "yes" : "no"} | Reviews: ${d.review_count ?? "—"}
- Estimated property count: ${d.estimated_property_count ?? "—"}
- Quality summary (already computed): ${d.quality_summary ?? "—"}

DETECTED WEIRD SIGNALS
${signals.map((s) => `- [${s.severity}] ${s.code}: ${s.description}`).join("\n") || "(none)"}

SCORES
- Lead Quality: ${scores.lead_quality_score}/100
- Confidence: ${scores.confidence_score}/100
- Compliance safety: ${scores.compliance_safety_score}/100
- Suggested service fit: ${scores.suggested_service_fit.join(", ")}
- Best outreach channel: ${scores.best_outreach_channel}

CONTACT PATHS AVAILABLE
${paths.slice(0, 5).map((p) => `- ${p.channel} (risk: ${p.risk_level}, consent: ${p.consent_required_before_marketing ? "required" : "not required"})`).join("\n")}

OUTPUT a JSON object with:
- summary: 2 sentences naming the operator and the headline opportunity. Factual.
- why_this_matters: 2 sentences explaining commercial relevance.
- estimated_operator_type: one of "individual host", "small portfolio", "concierge company", "agency", "luxury operator", "unknown".
- email_subject: <60 chars, references one specific observation, no clickbait.
- email_body: 4-6 short sentences. Lead with insight, end with one small ask (audit, benchmark, 15-min call). Include unsubscribe-friendly sign-off.
- linkedin: 2 sentences, suitable for a connect-with-note. No links.
- contact_form: 3 sentences, polite, useful, no exaggerated claims.
- postal: 5 short sentences for a printed letter. Reference public observations only.
- partner_intro: 2 sentences a mutual contact (photographer, cleaner, etc.) could forward.

IMPORTANT
- Never imply private knowledge. Only reference public observations.
- Never use "we noticed you" — say "looking at public listings" or similar.
- ${d.country.toLowerCase().includes("franc") ? "Write outreach in French." : "Write outreach in English."}

Return JSON only.`
    );

    if (!result) {
      return {
        summary: fallbackSummary,
        why_this_matters: fallbackWhy,
        estimated_operator_type: d.lead_type,
        outreach_drafts: { email_subject: `Quick question about ${d.primary_name}` },
      };
    }

    return {
      summary: result.summary || fallbackSummary,
      why_this_matters: result.why_this_matters || fallbackWhy,
      estimated_operator_type: result.estimated_operator_type || d.lead_type,
      outreach_drafts: {
        email_subject: result.email_subject,
        email_body: result.email_body,
        linkedin: result.linkedin,
        contact_form: result.contact_form,
        postal: result.postal,
        partner_intro: result.partner_intro,
      },
    };
  } catch (err) {
    console.error("[Dossier] Mammouth failed:", err instanceof Error ? err.message : err);
    return {
      summary: fallbackSummary,
      why_this_matters: fallbackWhy,
      estimated_operator_type: d.lead_type,
      outreach_drafts: {},
    };
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

export async function generateLeadDossier(
  d: DossierInput,
  complianceNotes: string[]
): Promise<LeadDossier> {
  const signals = scanLeadForWeirdSignals(leadForSignals(d));
  const paths = findContactPaths(leadForPaths(d));
  const scores = scoreLeadV2({
    base_score: d.score,
    reconstruction_confidence: d.reconstruction_confidence,
    exclusivity_score: d.exclusivity_score,
    estimated_property_count: d.estimated_property_count,
    superhost: d.superhost,
    review_count: d.review_count,
    has_website: Boolean(d.website_url),
    has_phone: Boolean(d.phone),
    has_email: Boolean(d.email),
    weird_signals: signals,
    contact_paths: paths,
    audit_score: d.audit_score,
    cluster_size: d.cluster_size,
    source_type: d.source_type,
  });

  const synth = await synthesise(d, signals, scores, paths);

  return {
    summary: synth.summary,
    why_this_matters: synth.why_this_matters,
    estimated_operator_type: synth.estimated_operator_type,
    scores,
    weird_signals: signals,
    contact_paths: paths,
    evidence_trail: buildEvidenceTrail(d, signals),
    pain_points: fallbackPainPoints(d, signals),
    suggested_offer: fallbackOffer(signals),
    recommended_next_action:
      scores.compliance_safety_score < 40
        ? "Verify compliance basis manually before any outreach."
        : scores.lead_quality_score >= 70
        ? `Reach out via ${scores.best_outreach_channel}: ${synth.outreach_drafts.email_subject ?? "see drafts below"}`
        : "Enrich first — run website audit and re-evaluate.",
    outreach_drafts: synth.outreach_drafts,
    compliance_notes: complianceNotes,
  };
}

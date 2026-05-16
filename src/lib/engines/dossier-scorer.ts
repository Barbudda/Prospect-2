// DOSSIER SCORER — multi-dimensional scoring used by the lead dossier.
//
// Produces three scores plus narrative output:
//   - Lead Quality Score (0-100)       — how strong is the opportunity
//   - Confidence Score (0-100)         — how sure are we this is real & matched
//   - Compliance Safety Score (0-100)  — how clean is the contact path
//
// Plus: suggested service fit, best outreach channel, reasoning summary.
//
// Complementary to scorer.ts (which produces the single authoritative score
// stored on leads.score). This module is consumed exclusively by lead-dossier
// and the dashboard for richer prioritisation displays.

import type { WeirdSignal } from "@/lib/engines/weird-signal-scanner";
import type { ContactPath } from "@/lib/engines/contact-path-finder";

export interface DossierScoreInput {
  base_score: number;            // existing lead.score (0-100)
  reconstruction_confidence?: number | null;
  exclusivity_score?: number | null;
  estimated_property_count?: number | null;
  superhost?: boolean | null;
  review_count?: number | null;
  has_website: boolean;
  has_phone: boolean;
  has_email: boolean;
  weird_signals: WeirdSignal[];
  contact_paths: ContactPath[];
  audit_score?: number | null;
  cluster_size?: number;
  source_type?: string | null;
}

export interface DossierScoreResult {
  lead_quality_score: number;
  confidence_score: number;
  compliance_safety_score: number;
  suggested_service_fit: string[];
  best_outreach_channel: string;
  reasoning_summary: string;
}

export function scoreLeadForDossier(input: DossierScoreInput): DossierScoreResult {
  // ── Lead Quality (0-100) ────────────────────────────────────────────────
  // Built from base score + weird signal severity + cluster size + audit gap
  let quality = input.base_score;

  const high = input.weird_signals.filter((s) => s.severity === "high").length;
  const med = input.weird_signals.filter((s) => s.severity === "medium").length;
  quality += high * 6 + med * 3;

  if ((input.cluster_size ?? 0) >= 3) quality += 10;
  if (input.superhost) quality += 5;
  if ((input.review_count ?? 0) >= 100) quality += 5;

  // Under-optimised website = bigger upside for the buyer
  if (typeof input.audit_score === "number") {
    const auditGap = 100 - input.audit_score; // 0 = perfect, 100 = abysmal
    quality += Math.min(auditGap / 4, 15);    // up to +15
  }

  quality = Math.max(0, Math.min(100, quality));

  // ── Confidence (0-100) ───────────────────────────────────────────────────
  // How sure are we this is real & matched correctly?
  let confidence = 50;
  if (input.reconstruction_confidence != null) {
    confidence = Math.max(confidence, input.reconstruction_confidence);
  }
  if (input.has_phone) confidence += 10;
  if (input.has_email) confidence += 5;
  if (input.has_website) confidence += 10;
  if ((input.cluster_size ?? 0) >= 2) confidence += 10; // cross-validated across listings
  confidence = Math.max(0, Math.min(100, confidence));

  // ── Compliance Safety (0-100) ────────────────────────────────────────────
  // How clean is contacting this lead?
  let safety = 60;
  const lowRiskPaths = input.contact_paths.filter((p) => p.risk_level === "low").length;
  const highRiskPaths = input.contact_paths.filter((p) => p.risk_level === "high").length;
  safety += lowRiskPaths * 7;
  safety -= highRiskPaths * 10;

  // Pro lead types are B2B → lower compliance risk
  if (input.source_type === "google_maps") safety += 10; // verified Business Profile
  if (input.estimated_property_count && input.estimated_property_count >= 3) safety += 5;

  safety = Math.max(0, Math.min(100, safety));

  // ── Service-fit suggestions ──────────────────────────────────────────────
  const fits = new Set<string>();
  for (const s of input.weird_signals) {
    if (s.code === "luxury_no_website") fits.add("Direct booking website");
    if (s.code === "luxury_no_direct_booking") fits.add("Booking engine integration");
    if (s.code === "social_only_no_website") fits.add("SEO landing page");
    if (s.code === "superhost_no_website") fits.add("Direct booking funnel");
    if (s.code === "multi_property_operator") fits.add("PMS + channel manager");
    if (s.code === "website_low_automation") fits.add("Conversion audit");
    if (s.code === "booking_no_faq") fits.add("AI guest assistant");
    if (s.code === "fr_market_en_only") fits.add("FR localisation");
    if (s.code === "actively_recruiting_owners") fits.add("B2B tools (you're their vendor)");
    if (s.code === "direct_booking_no_chatbot") fits.add("AI guest assistant");
  }
  if (fits.size === 0) fits.add("Discovery call — needs analysis");

  // ── Best outreach channel ────────────────────────────────────────────────
  const ranked = input.contact_paths
    .slice()
    .sort((a, b) => a.recommended_order - b.recommended_order);
  const best = ranked[0]?.channel ?? "partner_intro";

  // ── Reasoning summary ────────────────────────────────────────────────────
  const reasons: string[] = [];
  if (high > 0) reasons.push(`${high} high-severity weird signal${high > 1 ? "s" : ""}`);
  if (med > 0) reasons.push(`${med} medium signal${med > 1 ? "s" : ""}`);
  if ((input.cluster_size ?? 0) >= 2)
    reasons.push(`operator cluster of ${input.cluster_size} listings`);
  if (input.superhost) reasons.push("Superhost");
  if (input.has_phone && !input.has_website) reasons.push("phone but no website (direct-reach + high opportunity)");
  if (input.audit_score != null && input.audit_score < 50)
    reasons.push(`website audit score ${input.audit_score}/100 (large upside)`);

  const reasoning = reasons.length
    ? `Quality ${Math.round(quality)} / Confidence ${Math.round(confidence)} / Safety ${Math.round(safety)} — ${reasons.join("; ")}.`
    : `Quality ${Math.round(quality)} / Confidence ${Math.round(confidence)} / Safety ${Math.round(safety)} — base score only, no enrichment signals yet.`;

  return {
    lead_quality_score: Math.round(quality),
    confidence_score: Math.round(confidence),
    compliance_safety_score: Math.round(safety),
    suggested_service_fit: Array.from(fits),
    best_outreach_channel: best,
    reasoning_summary: reasoning,
  };
}

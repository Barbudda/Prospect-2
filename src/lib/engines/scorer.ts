import type { NormalizedLead, ScoreLabel } from "@/lib/types";

export interface ScoreBreakdown {
  score: number;
  label: ScoreLabel;
  reasons: string[];
}

export function scoreLead(lead: Partial<NormalizedLead>): ScoreBreakdown {
  let score = 0;
  const reasons: string[] = [];

  // Positive signals
  if (lead.email) {
    score += 25;
    reasons.push("+25: has confirmed email");
  }

  if (lead.phone) {
    score += 20;
    reasons.push("+20: has confirmed phone");
  }

  const keywords = (lead.quality_summary ?? "").toLowerCase();
  const type = (lead.lead_type ?? "").toLowerCase();
  const combined = keywords + " " + type;

  if (
    combined.includes("conciergerie") ||
    combined.includes("property management") ||
    combined.includes("location saisonnière")
  ) {
    score += 20;
    reasons.push("+20: mentions STR management keywords");
  }

  if (
    combined.includes("confiez") ||
    combined.includes("propriétaires") ||
    combined.includes("owner acquisition")
  ) {
    score += 20;
    reasons.push("+20: has owner acquisition page");
  }

  if (combined.includes("airbnb")) {
    score += 15;
    reasons.push("+15: mentions Airbnb explicitly");
  }

  if (lead.quality_summary?.match(/\d+\s*(logements?|properties|biens?)/i)) {
    score += 15;
    reasons.push("+15: indicates multiple properties managed");
  }

  if (
    lead.source_type === "direct_booking" ||
    combined.includes("réservation directe") ||
    combined.includes("book direct")
  ) {
    score += 15;
    reasons.push("+15: has direct booking site");
  }

  if (lead.lead_type && lead.lead_type !== "Unknown STR Lead") {
    score += 15;
    reasons.push("+15: likely professional STR operator");
  }

  if (lead.contact_form_url) {
    score += 10;
    reasons.push("+10: has contact form");
  }

  if (lead.website_url) {
    score += 10;
    reasons.push("+10: has website");
  }

  const sourceCount = lead.sources?.length ?? 0;
  if (sourceCount >= 2) {
    score += 10;
    reasons.push("+10: found via multiple independent sources");
  }

  if (lead.instagram_url || lead.linkedin_url) {
    score += 5;
    reasons.push("+5: has Instagram or LinkedIn presence");
  }

  // Negative signals
  if (!lead.email && !lead.phone && !lead.contact_form_url) {
    score -= 30;
    reasons.push("-30: no contact method found");
  }

  if (lead.source_type === "ota_listing") {
    score -= 25;
    reasons.push("-25: OTA-only listing page");
  }

  if (lead.lead_type === "Unknown STR Lead") {
    score -= 15;
    reasons.push("-15: low overall confidence");
  }

  score = Math.max(0, Math.min(100, score));

  let label: ScoreLabel = "Weak";
  if (score >= 80) label = "Hot";
  else if (score >= 60) label = "Good";
  else if (score >= 40) label = "Medium";

  return { score, label, reasons };
}

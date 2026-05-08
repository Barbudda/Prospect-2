import type { NormalizedLead, ScoreLabel } from "@/lib/types";

export interface ScoreBreakdown {
  score: number;
  label: ScoreLabel;
  reasons: string[];
}

export function scoreLead(lead: Partial<NormalizedLead>): ScoreBreakdown {
  let score = 0;
  const reasons: string[] = [];

  // ─ Contact methods (most important — we need a way to reach them) ─────────
  if (lead.email) {
    score += 25;
    reasons.push("+25: has confirmed email");
  }

  if (lead.phone) {
    score += 15;
    reasons.push("+15: has confirmed phone");
  }

  if (lead.whatsapp_url) {
    score += 15;
    reasons.push("+15: has WhatsApp (active host signal)");
  }

  if (lead.contact_form_url) {
    score += 8;
    reasons.push("+8: has contact form");
  }

  // ─ Business signals ────────────────────────────────────────────────────────
  const keywords = (lead.quality_summary ?? "").toLowerCase();
  const type = (lead.lead_type ?? "").toLowerCase();
  const combined = keywords + " " + type;

  if (
    combined.includes("conciergerie") ||
    combined.includes("property management") ||
    combined.includes("location saisonnière") ||
    combined.includes("gestion airbnb") ||
    combined.includes("gestion locative")
  ) {
    score += 20;
    reasons.push("+20: mentions STR management keywords");
  }

  if (
    combined.includes("confiez") ||
    combined.includes("propriétaires") ||
    combined.includes("owner acquisition") ||
    combined.includes("confiez-nous") ||
    combined.includes("confiez votre")
  ) {
    score += 20;
    reasons.push("+20: has owner acquisition messaging");
  }

  if (combined.includes("airbnb")) {
    score += 12;
    reasons.push("+12: mentions Airbnb explicitly");
  }

  // Number of properties managed — strong signal for scale
  const propertyMatch = lead.quality_summary?.match(/(\d+)\s*(logements?|properties|biens?|appartements?|villas?)/i);
  if (propertyMatch) {
    const count = parseInt(propertyMatch[1], 10);
    if (count >= 20) {
      score += 20;
      reasons.push(`+20: manages ${count}+ properties (large operator)`);
    } else if (count >= 5) {
      score += 15;
      reasons.push(`+15: manages ${count}+ properties`);
    } else {
      score += 8;
      reasons.push(`+8: mentions multiple properties (${count})`);
    }
  }

  if (
    lead.source_type === "direct_booking" ||
    combined.includes("réservation directe") ||
    combined.includes("book direct") ||
    combined.includes("réservez directement")
  ) {
    score += 12;
    reasons.push("+12: has direct booking site");
  }

  if (lead.lead_type && lead.lead_type !== "Unknown STR Lead") {
    score += 12;
    reasons.push("+12: likely professional STR operator");
  }

  // ─ Web presence ───────────────────────────────────────────────────────────
  if (lead.website_url) {
    score += 8;
    reasons.push("+8: has website");
  }

  const sourceCount = lead.sources?.length ?? 0;
  if (sourceCount >= 3) {
    score += 12;
    reasons.push("+12: found via 3+ independent sources");
  } else if (sourceCount >= 2) {
    score += 8;
    reasons.push("+8: found via multiple independent sources");
  }

  if (lead.instagram_url) {
    score += 5;
    reasons.push("+5: has Instagram presence");
  }

  if (lead.linkedin_url) {
    score += 5;
    reasons.push("+5: has LinkedIn presence");
  }

  if (lead.google_maps_url) {
    score += 3;
    reasons.push("+3: has Google Maps listing");
  }

  // ─ Negative signals ────────────────────────────────────────────────────────
  if (!lead.email && !lead.phone && !lead.contact_form_url && !lead.whatsapp_url) {
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

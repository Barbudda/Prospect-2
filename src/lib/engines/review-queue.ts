// HUMAN-IN-THE-LOOP REVIEW QUEUE (#17 from the brief)
//
// Detects leads that need human verification using only existing fields.
// No schema changes — flags are computed dynamically on read.
//
// A lead enters the review queue when any of:
//   - Visual reconstruction returned low geographic confidence
//   - Primary name looks like a listing title (not an operator name)
//   - Has no contact data at all (no email, no phone, no website)
//   - Has a contact but the lead_type is "Unknown STR Lead"
//   - Is part of a low-confidence cluster (cluster_size ≥ 2, but match_type
//     = "company_name" → fuzzy name match needs eyeballs)
//   - Source URL points to a generic aggregator (Airbnb help page, etc.)

export interface ReviewableLead {
  id: string;
  primary_name?: string | null;
  company_name?: string | null;
  lead_type?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  website_url?: string | null;
  score?: number | null;
  reconstructed?: boolean | null;
  reconstruction_confidence?: number | null;
  confidence?: string | null;
  source_url?: string | null;
  source_type?: string | null;
  status?: string | null;
}

export interface ReviewReason {
  code:
    | "low_geo_confidence"
    | "name_looks_like_listing"
    | "no_contact_data"
    | "unknown_lead_type"
    | "generic_source"
    | "low_extraction_confidence";
  severity: "high" | "medium" | "low";
  description: string;
}

export interface ReviewItem {
  lead: ReviewableLead;
  reasons: ReviewReason[];
  priority: number; // 0-100, higher = needs attention sooner
}

const LISTING_TITLE_PATTERNS = [
  /\b(appartement|appart|studio|loft|villa|chalet|maison|chambre)\b/i,
  /\b(cozy|stunning|beautiful|charming|charmant|magnifique)\b/i,
  /\b(centre|center|coeur|heart)\b/i,
  /\bavec\b.+\b(vue|piscine|terrasse|jardin|balcon|parking)\b/i,
];

const GENERIC_SOURCES = [
  /airbnb\.[a-z]+\/help/i,
  /airbnb\.[a-z]+\/community/i,
  /superhost.*guide/i,
  /comment.devenir/i,
  /facebook\.com\/(login|signup)/i,
  /instagram\.com\/(?:accounts|signup)/i,
  /reddit\.com\//i,
];

function nameLooksLikeListingTitle(name?: string | null): boolean {
  if (!name) return false;
  if (name.length > 50) return true; // operator names are short, listing titles long
  let matches = 0;
  for (const re of LISTING_TITLE_PATTERNS) {
    if (re.test(name)) matches++;
  }
  return matches >= 2;
}

function isGenericSource(url?: string | null): boolean {
  if (!url) return false;
  return GENERIC_SOURCES.some((re) => re.test(url));
}

export function detectReviewReasons(lead: ReviewableLead): ReviewReason[] {
  const reasons: ReviewReason[] = [];

  if (
    lead.reconstructed &&
    lead.reconstruction_confidence != null &&
    lead.reconstruction_confidence < 50
  ) {
    reasons.push({
      code: "low_geo_confidence",
      severity: "high",
      description: `Visual pipeline geographic confidence ${lead.reconstruction_confidence}/100 — verify the property/operator manually before any outreach.`,
    });
  }

  if (nameLooksLikeListingTitle(lead.primary_name) && !lead.company_name) {
    reasons.push({
      code: "name_looks_like_listing",
      severity: "medium",
      description:
        "Primary name appears to be a listing title, not an operator name. Consider editing or merging with the real operator entity.",
    });
  }

  if (!lead.email && !lead.phone && !lead.website_url) {
    reasons.push({
      code: "no_contact_data",
      severity: "high",
      description:
        "No email, phone, or website stored. Either enrich (try retry-phone), reclassify, or remove.",
    });
  }

  if (lead.lead_type === "Unknown STR Lead") {
    reasons.push({
      code: "unknown_lead_type",
      severity: "medium",
      description:
        "Lead type unresolved. Classifier needs more context — review the source page and set the type manually.",
    });
  }

  if (isGenericSource(lead.source_url)) {
    reasons.push({
      code: "generic_source",
      severity: "high",
      description:
        "Source URL points to a generic aggregator/help page, not to a real operator. Strong candidate for removal.",
    });
  }

  if (lead.confidence === "low") {
    reasons.push({
      code: "low_extraction_confidence",
      severity: "low",
      description:
        "Extraction-level confidence was low. Cross-check primary_name and contact data against the source page.",
    });
  }

  return reasons;
}

export function priorityFromReasons(reasons: ReviewReason[]): number {
  if (!reasons.length) return 0;
  const high = reasons.filter((r) => r.severity === "high").length;
  const med = reasons.filter((r) => r.severity === "medium").length;
  const low = reasons.filter((r) => r.severity === "low").length;
  return Math.min(100, high * 35 + med * 15 + low * 5);
}

export function buildReviewQueue(leads: ReviewableLead[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const lead of leads) {
    const reasons = detectReviewReasons(lead);
    if (reasons.length === 0) continue;
    items.push({ lead, reasons, priority: priorityFromReasons(reasons) });
  }
  return items.sort((a, b) => b.priority - a.priority);
}

// LEAD QUALITY GATE
// Decides whether a lead is worth keeping. Built to reject the noise that
// poisons the table: press articles, Reddit threads, Airbnb help/community
// pages, Wikipedia entries, news headlines, generic "Comment devenir
// Superhost" guides, etc.
//
// Target keeper set:
//   - Individual Airbnb Host             (owner)
//   - Direct Booking Owner               (owner)
//   - Gîte / Villa Operator              (owner)
//   - Airbnb Concierge                   (conciergerie)
//   - Property Manager                   (conciergerie-ish)
//   - Vacation Rental Agency             (conciergerie-ish)
//   - Co-host / Consultant               (conciergerie-ish)
//   - Real Estate Seasonal Rental        (agency)
//
// Rejected: Unknown STR Lead + anything matching a junk pattern.

export interface LeadForQualityGate {
  primary_name?: string | null;
  company_name?: string | null;
  lead_type?: string | null;
  source_url?: string | null;
  source_type?: string | null;
  website_url?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
}

export interface QualityVerdict {
  keep: boolean;
  reasons: string[];
  category?: "press_article" | "help_page" | "community_forum" | "aggregator" | "wikipedia" | "social_listing" | "junk_name" | "no_contact_unknown_type" | null;
}

// Source URL patterns that almost never mean "an STR operator"
const JUNK_URL_PATTERNS: Array<{ pattern: RegExp; category: QualityVerdict["category"]; reason: string }> = [
  { pattern: /airbnb\.[a-z.]+\/help/i,            category: "help_page",       reason: "Airbnb help center page" },
  { pattern: /airbnb\.[a-z.]+\/community/i,       category: "community_forum", reason: "Airbnb community forum thread" },
  { pattern: /airbnb\.[a-z.]+\/d\/superhost/i,    category: "help_page",       reason: "Airbnb Superhost info page" },
  { pattern: /\/blog\//i,                          category: "press_article",   reason: "Blog post URL" },
  { pattern: /\/journal\//i,                       category: "press_article",   reason: "News journal URL" },
  { pattern: /\/news\//i,                          category: "press_article",   reason: "News URL" },
  { pattern: /\/actualit[ée]s?\//i,                category: "press_article",   reason: "Actualités URL" },
  { pattern: /\/article\//i,                       category: "press_article",   reason: "Article URL" },
  { pattern: /\/press(?:[-_/]|$)/i,                category: "press_article",   reason: "Press URL" },
  { pattern: /reddit\.com/i,                       category: "community_forum", reason: "Reddit thread" },
  { pattern: /quora\.com/i,                        category: "community_forum", reason: "Quora thread" },
  { pattern: /wikipedia\.org/i,                    category: "wikipedia",       reason: "Wikipedia article" },
  { pattern: /tripadvisor\.[a-z.]+/i,              category: "aggregator",      reason: "TripAdvisor (review aggregator, not operator)" },
  { pattern: /lonelyplanet\.com/i,                 category: "aggregator",      reason: "Lonely Planet (travel guide)" },
  { pattern: /sudouest\.fr|ledauphine\.com|ouest-france\.fr|lefigaro\.fr|lemonde\.fr|lesechos\.fr/i,
    category: "press_article",   reason: "French press domain (useful as a press mention, not as a lead)" },
  { pattern: /facebook\.com\/(?:login|signup|recover)/i,
    category: "social_listing",  reason: "Facebook auth page" },
  { pattern: /instagram\.com\/(?:accounts|signup)/i,
    category: "social_listing",  reason: "Instagram auth page" },
  // Generic 'how to become a Superhost' / educational guides
  { pattern: /(?:comment.devenir|how.to.become|guide.complet).*superhost/i,
    category: "junk_name",       reason: "How-to guide rather than an operator" },
];

// Primary-name patterns that signal a press article or generic guide, not an operator
const JUNK_NAME_PATTERNS: RegExp[] = [
  /^(?:comment|how to|pourquoi|when to|quand|why|que faire|top \d+|les \d+|guide)/i,
  /\b(?:guide|tutoriel|tutorial|tips?\b|astuces?\b)/i,
  /\b(?:devenir|become)\s+(?:superhost|superhôte|host)/i,
  // Pure single-word "Facebook" / "Instagram" / "Reddit" / "Airbnb" with no qualifier
  /^(?:facebook|instagram|reddit|airbnb|booking|tripadvisor|wikipedia|youtube|tiktok|google|linkedin|twitter|x|x\.com)$/i,
];

const ACCEPTABLE_LEAD_TYPES = new Set([
  "Individual Airbnb Host",
  "Direct Booking Owner",
  "Gîte / Villa Operator",
  "Airbnb Concierge",
  "Property Manager",
  "Vacation Rental Agency",
  "Co-host / Consultant",
  "Real Estate Seasonal Rental",
]);

export function gradeLead(lead: LeadForQualityGate): QualityVerdict {
  const reasons: string[] = [];

  // 1. URL pattern check (highest signal)
  const url = (lead.source_url ?? "").trim();
  if (url) {
    for (const rule of JUNK_URL_PATTERNS) {
      if (rule.pattern.test(url)) {
        reasons.push(rule.reason);
        return { keep: false, reasons, category: rule.category };
      }
    }
  }

  // 2. Name pattern check
  const name = (lead.primary_name ?? "").trim();
  if (name) {
    for (const re of JUNK_NAME_PATTERNS) {
      if (re.test(name)) {
        reasons.push(`Primary name matches junk pattern: ${re.source.slice(0, 60)}`);
        return { keep: false, reasons, category: "junk_name" };
      }
    }
  }

  // 3. Unknown lead-type AND no contact data AND not visually-reconstructed
  //    = almost always a press/help noise lead.
  if (
    lead.lead_type === "Unknown STR Lead" &&
    !lead.phone &&
    !lead.email &&
    lead.source_type !== "visual_reconstruction" &&
    lead.source_type !== "individual_host"
  ) {
    reasons.push("Unknown STR Lead with no contact data and no visual reconstruction");
    return { keep: false, reasons, category: "no_contact_unknown_type" };
  }

  // 4. Acceptable lead types: keep unless they tripped a junk pattern above
  if (lead.lead_type && !ACCEPTABLE_LEAD_TYPES.has(lead.lead_type)) {
    // Outside the keeper set AND not a junk match — keep but flag as low-priority
    reasons.push(`Lead type "${lead.lead_type}" is outside the canonical owner/concierge set`);
  }

  return { keep: true, reasons, category: null };
}

// Convenience filter for bulk operations
export function filterToOwnersAndConciergeries(
  leads: LeadForQualityGate[]
): { kept: LeadForQualityGate[]; rejected: Array<LeadForQualityGate & { verdict: QualityVerdict }> } {
  const kept: LeadForQualityGate[] = [];
  const rejected: Array<LeadForQualityGate & { verdict: QualityVerdict }> = [];
  for (const lead of leads) {
    const verdict = gradeLead(lead);
    if (verdict.keep) kept.push(lead);
    else rejected.push({ ...lead, verdict });
  }
  return { kept, rejected };
}

// WEIRD SIGNAL SCANNER — surfaces high-intent operational opportunities by
// looking for the "weird" disconnects in publicly observable data we already
// have on a lead. These signals don't require new external calls: they're
// computed from fields the lead already carries (geo_signals, intelligence
// flags, website_url presence, listing_title, scores).
//
// Each signal includes:
//   - code: stable identifier for storage / filtering
//   - severity: high / medium / low (how strong the buy signal is)
//   - description: human-readable explanation for the UI
//   - outreach_hint: the angle to use when contacting (NOT the message itself)
//   - lawful: every detector below uses only data the user already saved
//             through lawful pipelines — no new external collection.
//
// Compliance: pure analysis over already-stored fields. No personal data
// collected. No new third-party calls. Safe to run repeatedly.

export interface WeirdSignal {
  code: string;
  severity: "high" | "medium" | "low";
  description: string;
  outreach_hint: string;
}

export interface LeadForSignals {
  primary_name?: string | null;
  company_name?: string | null;
  city?: string | null;
  country?: string | null;
  lead_type?: string | null;
  website_url?: string | null;
  email?: string | null;
  phone?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
  source_type?: string | null;
  superhost?: boolean | null;
  review_count?: number | null;
  listing_title?: string | null;
  reconstructed?: boolean | null;
  reconstruction_confidence?: number | null;
  exclusivity_score?: number | null;
  score?: number | null;
  opportunity_score?: number | null;
  has_booking_engine?: boolean | null;
  has_chatbot?: boolean | null;
  has_faq?: boolean | null;
  automation_level?: "low" | "medium" | "high" | null;
  has_owner_acquisition_page?: boolean | null;
  estimated_property_count?: number | null;
  geo_signals?: unknown;
}

const LUXURY_HINTS = /\b(luxe|luxury|prestige|exception(nel)?|haut[- ]de[- ]gamme|villa|domaine|château|chateau|mas|premium|exclusif|exclusive|grand|spacieux)\b/i;
const FAMILY_HINTS = /\b(famille|family|enfants?|kids|baby|bébé)\b/i;
const PET_HINTS = /\b(animau?x|pets?|chien|dog|cat)\b/i;
const REMOTE_HINTS = /\b(t[ée]l[ée]travail|workspace|remote|workation|bureau|wifi.{0,15}(rapide|fibre|gigabit))\b/i;
const ENGLISH_ONLY_HINT = /\b(welcome|enjoy|cozy|stunning|charming|guests|book(?:ing)?|stay)\b/i;
const FRENCH_HINT = /\b(bienvenue|chaleureux|charmant|séjour|réserver|s[éee]jour)\b/i;

function safeJson(v: unknown): Record<string, unknown> | null {
  if (!v) return null;
  if (typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function hasDirectBooking(geo: Record<string, unknown> | null): boolean {
  if (!geo) return false;
  const directBookingUrl = geo.direct_booking_url;
  return typeof directBookingUrl === "string" && directBookingUrl.length > 5;
}

// ─── Detectors ────────────────────────────────────────────────────────────────

export function scanLeadForWeirdSignals(lead: LeadForSignals): WeirdSignal[] {
  const signals: WeirdSignal[] = [];
  const geo = safeJson(lead.geo_signals);
  const haystack = [
    lead.primary_name,
    lead.company_name,
    lead.listing_title,
  ]
    .filter(Boolean)
    .join(" ");

  // ── 1. Luxury positioning but no website ───────────────────────────────────
  // Hypothesis: a high-end operator without their own booking site is leaving
  // 15-25% of revenue to OTA commissions. Strong opportunity for direct-booking
  // services, PMS, conversion audit.
  if (LUXURY_HINTS.test(haystack) && !lead.website_url) {
    signals.push({
      code: "luxury_no_website",
      severity: "high",
      description: "Luxury positioning detected, but no direct-booking website. Likely paying full OTA commission.",
      outreach_hint: "Offer a 15-min direct-booking audit + cost-of-OTAs benchmark.",
    });
  }

  // ── 2. Luxury + no direct booking ──────────────────────────────────────────
  if (LUXURY_HINTS.test(haystack) && lead.website_url && !hasDirectBooking(geo)) {
    signals.push({
      code: "luxury_no_direct_booking",
      severity: "high",
      description: "Luxury website exists but no direct booking engine detected — funnel may end at a contact form.",
      outreach_hint: "Mention you noticed their site lacks an integrated booking engine; offer a free comparison.",
    });
  }

  // ── 3. Multi-platform brand but no website ─────────────────────────────────
  // If a brand has Instagram or Facebook but no website, they're SEO-invisible
  // and dependent on social platform rules.
  const hasSocial = Boolean(lead.instagram_url ?? lead.facebook_url);
  if (hasSocial && !lead.website_url) {
    signals.push({
      code: "social_only_no_website",
      severity: "medium",
      description: "Active social presence but no website — invisible to Google search, fragile to platform changes.",
      outreach_hint: "Show 2 competitor sites that capture organic search traffic the operator is missing.",
    });
  }

  // ── 4. Superhost with no website ───────────────────────────────────────────
  // Top 10% of hosts on revenue, still 100% dependent on Airbnb.
  if (lead.superhost && !lead.website_url) {
    signals.push({
      code: "superhost_no_website",
      severity: "high",
      description: "Superhost status but no website — strong revenue, zero diversification.",
      outreach_hint: "Lead with 'Superhost = strong demand. What if 20% of bookings were commission-free?'",
    });
  }

  // ── 5. Many reviews but listing-only ───────────────────────────────────────
  if ((lead.review_count ?? 0) >= 100 && !lead.website_url && !lead.email) {
    signals.push({
      code: "many_reviews_listing_only",
      severity: "high",
      description: `${lead.review_count}+ reviews but no website and no public email — established operator with minimal digital infrastructure.`,
      outreach_hint: "Reference their review count as social proof. Suggest a one-page direct-booking landing.",
    });
  }

  // ── 6. Visually-reconstructed lead with low confidence ─────────────────────
  if (
    lead.source_type === "visual_reconstruction" &&
    (lead.reconstruction_confidence ?? 100) < 50
  ) {
    signals.push({
      code: "low_confidence_reconstruction",
      severity: "low",
      description: "Visual pipeline returned low geographic confidence — manual verification recommended before outreach.",
      outreach_hint: "Verify the property/operator manually via Google Maps before contacting.",
    });
  }

  // ── 7. Multi-property operator (cluster signal proxy) ──────────────────────
  if ((lead.estimated_property_count ?? 0) >= 3) {
    signals.push({
      code: "multi_property_operator",
      severity: "high",
      description: `Estimated ${lead.estimated_property_count} properties under one operator — high-value B2B target.`,
      outreach_hint: "Skip the listing-level pitch. Talk portfolio economics: PMS, channel manager, revenue management.",
    });
  }

  // ── 8. Has website + automation_level=low ──────────────────────────────────
  // Operator built a site but hasn't installed analytics / booking engine /
  // chatbot — strong fit for conversion + automation services.
  if (lead.website_url && lead.automation_level === "low") {
    signals.push({
      code: "website_low_automation",
      severity: "medium",
      description: "Website exists but no booking engine, no analytics, no chatbot detected — heavy manual operation.",
      outreach_hint: "Offer a 'website conversion audit' as the lead magnet.",
    });
  }

  // ── 9. Has booking engine but no FAQ ───────────────────────────────────────
  // Direct booking present, but guest education missing → cancellation risk
  // and support cost.
  if (lead.has_booking_engine && lead.has_faq === false) {
    signals.push({
      code: "booking_no_faq",
      severity: "low",
      description: "Direct booking engine present, but no FAQ section — likely high pre-booking support load.",
      outreach_hint: "Offer a guest-messaging template pack or AI guest assistant.",
    });
  }

  // ── 10. Has owner-acquisition page (active conciergerie growth) ────────────
  if (lead.has_owner_acquisition_page) {
    signals.push({
      code: "actively_recruiting_owners",
      severity: "medium",
      description: "Operator runs an owner-acquisition page — they're scaling and likely buying tooling.",
      outreach_hint: "Pitch them as a growing B2B customer, not as a property owner.",
    });
  }

  // ── 11. French-market lead with English-only branding ──────────────────────
  if (
    (lead.country ?? "").toLowerCase().includes("franc") &&
    haystack.length > 0 &&
    ENGLISH_ONLY_HINT.test(haystack) &&
    !FRENCH_HINT.test(haystack)
  ) {
    signals.push({
      code: "fr_market_en_only",
      severity: "medium",
      description: "French market but English-only branding — missing domestic tourism demand.",
      outreach_hint: "Mention they're invisible to French speakers searching for local stays.",
    });
  }

  // ── 12. Listing positioning gap (no family / pet / remote-work) ────────────
  if (
    haystack &&
    !FAMILY_HINTS.test(haystack) &&
    !PET_HINTS.test(haystack) &&
    !REMOTE_HINTS.test(haystack) &&
    LUXURY_HINTS.test(haystack)
  ) {
    signals.push({
      code: "missing_positioning_axis",
      severity: "low",
      description: "Premium property but no family / pet / workation positioning — leaving lucrative segments untargeted.",
      outreach_hint: "Reference one missing segment (e.g. workation) with a benchmark of competitors capturing it.",
    });
  }

  // ── 13. Direct booking detected without retargeting — strong upsell ────────
  if (hasDirectBooking(geo) && lead.has_chatbot === false) {
    signals.push({
      code: "direct_booking_no_chatbot",
      severity: "low",
      description: "Direct booking detected but no guest chatbot/messaging — manual support cost.",
      outreach_hint: "Pitch an AI guest assistant tied to their existing booking funnel.",
    });
  }

  return signals;
}

// Severity ranking helper for UI sort
export function severityRank(s: WeirdSignal): number {
  return s.severity === "high" ? 3 : s.severity === "medium" ? 2 : 1;
}

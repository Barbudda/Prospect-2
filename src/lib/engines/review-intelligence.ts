// REVIEW INTELLIGENCE LITE (#9 from the brief)
//
// Full version of #9 needs partner-approved guest-review data. This lite
// version operates only on fields we already lawfully store:
//   - quality_summary (Mammouth-written, references public signals)
//   - listing_title
//   - exterior signals (mailbox/permit/plaque text)
//
// It surfaces patterns suggesting guest pain points or amenity gaps that the
// operator may benefit from addressing. Outputs are HYPOTHESES with low/medium
// confidence — they're hints for outreach personalisation, not facts.

export type ReviewSignalKind =
  | "missing_workspace"
  | "missing_family_amenities"
  | "missing_pet_friendly"
  | "missing_breakfast"
  | "missing_parking"
  | "missing_wifi_emphasis"
  | "luxury_mismatch"
  | "no_late_checkin_mention"
  | "no_transport_mention"
  | "english_only_branding"
  | "french_only_branding";

export interface ReviewSignal {
  kind: ReviewSignalKind;
  severity: "high" | "medium" | "low";
  description: string;
  service_hypothesis: string;
}

export interface LeadForReviewIntel {
  primary_name?: string | null;
  company_name?: string | null;
  listing_title?: string | null;
  quality_summary?: string | null;
  lead_type?: string | null;
  city?: string | null;
  country?: string | null;
}

const LUXURY = /\b(luxe|luxury|prestige|exception|haut[- ]de[- ]gamme|villa|domaine|château|chateau|premium|exclusif)\b/i;
const WORKSPACE = /\b(workspace|bureau|t[ée]l[ée]travail|wifi.{0,20}(rapide|fibre|gigabit)|remote.work)\b/i;
const FAMILY = /\b(famille|family|enfants?|kids?|baby|b[ée]b[ée]|berceau|crib|chaise.haute|highchair)\b/i;
const PETS = /\b(animaux|animal|pets?|chien|dog|cat)\b/i;
const BREAKFAST = /\b(petit.d[ée]jeuner|breakfast|brunch|caf[ée] inclus)\b/i;
const PARKING = /\b(parking|garage|stationnement|park gratuit)\b/i;
const WIFI = /\b(wifi|wi-fi|internet|fibre|fiber)\b/i;
const LATE_CHECKIN = /\b(self.check-?in|late.check-?in|arriv[ée]e tardive|cl[ée] auto|smart.lock|boite.cl[ée]s)\b/i;
const TRANSPORT = /\b(gare|m[ée]tro|tram|bus|a[ée]roport|airport|train|navette|shuttle)\b/i;
const ENGLISH = /\b(welcome|enjoy|stay|guests?|book(?:ing)?|relax|nestled|stunning|charming)\b/i;
const FRENCH = /\b(bienvenue|s[ée]jour|voyageurs?|r[ée]server|d[ée]tente|charmant|magnifique)\b/i;

export function scanReviewIntelligence(lead: LeadForReviewIntel): ReviewSignal[] {
  const haystack = [lead.listing_title, lead.primary_name, lead.quality_summary]
    .filter(Boolean)
    .join(" ")
    .slice(0, 4000);

  if (!haystack) return [];

  const signals: ReviewSignal[] = [];

  // ── Missing positioning axes ───────────────────────────────────────────────
  if (!WORKSPACE.test(haystack)) {
    signals.push({
      kind: "missing_workspace",
      severity: "low",
      description: "No mention of workspace, remote work, or fast wifi in the operator's positioning.",
      service_hypothesis: "Workation segment: family/couples on extended stays are willing to pay 15-25% more for proven workspace amenities.",
    });
  }
  if (!FAMILY.test(haystack)) {
    signals.push({
      kind: "missing_family_amenities",
      severity: "low",
      description: "No mention of family amenities (crib, high chair, kids equipment).",
      service_hypothesis: "Family segment is a stable, high-LTV booker. A short amenities upgrade pays back fast.",
    });
  }
  if (!PETS.test(haystack)) {
    signals.push({
      kind: "missing_pet_friendly",
      severity: "low",
      description: "No mention of pet-friendly policy.",
      service_hypothesis: "Pet-friendly listings rent ~10-20% faster in residential French markets. Optional clean-up fee covers risk.",
    });
  }
  if (!BREAKFAST.test(haystack) && /b\&b|bed.and.breakfast|guest.house/i.test(lead.lead_type ?? "")) {
    signals.push({
      kind: "missing_breakfast",
      severity: "medium",
      description: "Lead type implies B&B/Guest house but breakfast is not mentioned in positioning.",
      service_hypothesis: "Selling breakfast as a paid add-on yields €8-15 per stay-night with minimal cost.",
    });
  }
  if (!PARKING.test(haystack)) {
    signals.push({
      kind: "missing_parking",
      severity: "low",
      description: "No mention of parking — strong filter for car-arriving guests.",
      service_hypothesis: "If parking exists, surfacing it explicitly raises conversion. If not, a partnership with a nearby paid lot does too.",
    });
  }
  if (!WIFI.test(haystack)) {
    signals.push({
      kind: "missing_wifi_emphasis",
      severity: "low",
      description: "WiFi not emphasised in the public copy.",
      service_hypothesis: "Even basic wifi mention raises filter-by-amenity ranking on OTAs.",
    });
  }
  if (!LATE_CHECKIN.test(haystack)) {
    signals.push({
      kind: "no_late_checkin_mention",
      severity: "medium",
      description: "Self/late check-in not advertised — operator probably handing keys manually.",
      service_hypothesis: "Smart-lock or keypad install pays back in saved time within ~30 stays; partner referral opportunity.",
    });
  }
  if (!TRANSPORT.test(haystack)) {
    signals.push({
      kind: "no_transport_mention",
      severity: "low",
      description: "No transport/transit info in positioning.",
      service_hypothesis: "Foreign guests rank transport distance highly — easy positioning fix that lifts bookings.",
    });
  }

  // ── Luxury / language mismatches ──────────────────────────────────────────
  const isFrenchMarket = (lead.country ?? "").toLowerCase().includes("franc");
  if (isFrenchMarket && ENGLISH.test(haystack) && !FRENCH.test(haystack)) {
    signals.push({
      kind: "english_only_branding",
      severity: "medium",
      description: "French market but the public copy reads English-only.",
      service_hypothesis: "French domestic tourism is the largest segment in FR. Add a French-language version to the funnel.",
    });
  }
  if (!isFrenchMarket && FRENCH.test(haystack) && !ENGLISH.test(haystack)) {
    signals.push({
      kind: "french_only_branding",
      severity: "low",
      description: "Non-French market but copy is French-only — limits foreign-traveller conversion.",
      service_hypothesis: "Adding English copy is the cheapest way to broaden the funnel.",
    });
  }

  // ── Luxury mismatch ───────────────────────────────────────────────────────
  if (LUXURY.test(haystack) && !WORKSPACE.test(haystack) && !FAMILY.test(haystack)) {
    signals.push({
      kind: "luxury_mismatch",
      severity: "medium",
      description: "Luxury positioning but no premium segment cues (workation, family, concierge).",
      service_hypothesis: "Premium copy without premium amenities limits the price ceiling. Audit the actual offer vs. the wording.",
    });
  }

  return signals;
}

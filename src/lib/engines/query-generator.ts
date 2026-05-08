// Generates localized search query lists for a given city/country/target type

type TargetType = "all" | "concierges" | "property_managers" | "direct_owners" | "agencies";

interface QuerySet {
  localBusiness: string[];
  webSearch: string[];
}

const FRENCH_SPEAKING_COUNTRIES = new Set([
  "france", "belgique", "belgium", "suisse", "switzerland",
  "luxembourg", "monaco", "canada", "martinique", "guadeloupe",
  "réunion", "reunion", "polynésie", "polynesie",
]);

function isFrenchSpeaking(country: string): boolean {
  return FRENCH_SPEAKING_COUNTRIES.has(country.toLowerCase().trim());
}

export function generateQueries(
  city: string,
  country: string,
  targetType: TargetType = "all",
  maxQueries = 20
): QuerySet {
  const fr = isFrenchSpeaking(country);
  const c = city;
  const queries: QuerySet = { localBusiness: [], webSearch: [] };

  // ── Local Business queries ────────────────────────────────────────────────
  const lbFr = [
    `conciergerie Airbnb ${c}`,
    `gestion Airbnb ${c}`,
    `gestion location courte durée ${c}`,
    `location saisonnière gestion ${c}`,
    `conciergerie location saisonnière ${c}`,
    `gestion villa vacances ${c}`,
    `agence location saisonnière ${c}`,
    `Airbnb co host ${c}`,
    `gestionnaire location saisonnière ${c}`,
    `property management Airbnb ${c}`,
  ];

  const lbEn = [
    `Airbnb property management ${c}`,
    `short term rental management ${c}`,
    `vacation rental management ${c}`,
    `Airbnb concierge ${c}`,
    `Airbnb co-host ${c}`,
    `holiday rental agency ${c}`,
    `STR management ${c}`,
    `Airbnb management company ${c}`,
  ];

  queries.localBusiness = fr
    ? [...lbFr, ...lbEn].slice(0, maxQueries)
    : [...lbEn, ...lbFr].slice(0, maxQueries);

  // ── Web Search queries ────────────────────────────────────────────────────
  const allWebFr = [
    // Concierge / management
    `conciergerie Airbnb ${c}`,
    `gestion Airbnb ${c}`,
    `gestion location courte durée ${c}`,
    `gestion location saisonnière ${c}`,
    `co-hôte Airbnb ${c}`,
    `cohost Airbnb ${c}`,
    // Direct booking
    `location vacances ${c} contact propriétaire`,
    `villa ${c} réservation directe`,
    `maison vacances ${c} contact`,
    `gîte ${c} contact propriétaire`,
    `appartement vacances ${c} réservation directe`,
    // Airbnb-related
    `Airbnb ${c} contact`,
    `Superhost ${c} Airbnb`,
    `hôte Airbnb ${c}`,
    `Airbnb villa ${c}`,
    `Airbnb maison ${c} propriétaire`,
    // Social discovery
    `site:instagram.com conciergerie Airbnb ${c}`,
    `site:instagram.com location saisonnière ${c}`,
    `site:linkedin.com/company conciergerie Airbnb ${c}`,
    `site:facebook.com conciergerie Airbnb ${c}`,
  ];

  const allWebEn = [
    `Airbnb concierge ${c}`,
    `property manager Airbnb ${c}`,
    `short term rental management ${c}`,
    `vacation rental agency ${c}`,
    `Airbnb co-host ${c}`,
    `book direct ${c} vacation rental`,
    `direct booking ${c} Airbnb`,
    `holiday rental ${c} owner contact`,
    `Airbnb superhost ${c}`,
    `STR management company ${c}`,
    `site:instagram.com Airbnb ${c}`,
    `site:linkedin.com/company vacation rental ${c}`,
    `site:facebook.com Airbnb ${c}`,
  ];

  let webQueries: string[] = fr
    ? [...allWebFr, ...allWebEn]
    : [...allWebEn, ...allWebFr];

  // Filter by target type
  if (targetType !== "all") {
    const filterMap: Record<string, string[]> = {
      concierges: ["conciergerie", "concierge", "gestion", "management", "gestionnaire"],
      property_managers: ["property manager", "gestionnaire", "gestion locative", "property management"],
      direct_owners: ["propriétaire", "réservation directe", "book direct", "owner contact"],
      agencies: ["agence", "agency", "saisonnière", "seasonal"],
    };
    const keywords = filterMap[targetType] || [];
    if (keywords.length > 0) {
      webQueries = webQueries.filter((q) =>
        keywords.some((k) => q.toLowerCase().includes(k))
      );
    }
  }

  queries.webSearch = webQueries.slice(0, maxQueries);

  return queries;
}

export function detectLanguage(country: string): string {
  return isFrenchSpeaking(country) ? "fr" : "en";
}

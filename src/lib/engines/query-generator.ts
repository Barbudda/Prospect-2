// Generates localized search query lists for a given city/country/target type

type TargetType = "all" | "concierges" | "property_managers" | "direct_owners" | "agencies" | "individual_hosts";

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
    `gestion appartement vacances ${c}`,
    `location meublé tourisme ${c}`,
    `agence immobilière location saisonnière ${c}`,
    `gestion locative courte durée ${c}`,
    `conciergerie vacances ${c}`,
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
    `vacation rental company ${c}`,
  ];

  queries.localBusiness = fr
    ? [...lbFr, ...lbEn].slice(0, maxQueries)
    : [...lbEn, ...lbFr].slice(0, maxQueries);

  // ── Web Search queries ────────────────────────────────────────────────────
  const allWebFr: string[] = [];

  // ─ Concierge / management ─
  if (targetType === "all" || targetType === "concierges" || targetType === "property_managers") {
    allWebFr.push(
      `conciergerie Airbnb ${c}`,
      `gestion Airbnb ${c}`,
      `gestion location courte durée ${c}`,
      `gestion location saisonnière ${c}`,
      `co-hôte Airbnb ${c}`,
      `cohost Airbnb ${c}`,
      `gestionnaire Airbnb ${c}`,
      `service conciergerie Airbnb ${c}`,
      `"gestion Airbnb" ${c}`,
      `"location courte durée" gestion ${c}`,
      `confiez votre appartement Airbnb ${c}`,
      `"location saisonnière" gestion ${c}`,
      `gestion locative Airbnb ${c}`,
      `"property management" ${c} Airbnb`,
      `Airbnb property manager ${c}`,
      `gestionnaire location touristique ${c}`,
    );
  }

  // ─ Direct booking owners ─
  if (targetType === "all" || targetType === "direct_owners") {
    allWebFr.push(
      `location vacances ${c} contact propriétaire`,
      `villa ${c} réservation directe`,
      `maison vacances ${c} contact`,
      `gîte ${c} contact propriétaire`,
      `appartement vacances ${c} réservation directe`,
      `"réservation directe" villa ${c}`,
      `"réservez directement" ${c}`,
      `location villa ${c} particulier`,
      `location appartement ${c} propriétaire direct`,
      `chalet ${c} réservation directe propriétaire`,
      `maison hôtes ${c} contact`,
    );
  }

  // ─ Agencies ─
  if (targetType === "all" || targetType === "agencies") {
    allWebFr.push(
      `agence location saisonnière ${c}`,
      `agence immobilière location courte durée ${c}`,
      `agence location vacances ${c}`,
      `"location saisonnière" agence ${c}`,
      `agence tourisme location ${c}`,
      `location meublé tourisme ${c} agence`,
    );
  }

  // ─ Airbnb-related (companies + individuals) ─
  if (targetType === "all") {
    allWebFr.push(
      `Airbnb ${c} contact`,
      `Superhost ${c} Airbnb`,
      `hôte Airbnb ${c}`,
      `Airbnb villa ${c}`,
      `Airbnb maison ${c} propriétaire`,
      `superhôte Airbnb ${c}`,
      `"Airbnb" "contact" ${c}`,
    );
  }

  // ─ Individual hosts ─
  if (targetType === "individual_hosts") {
    allWebFr.push(
      `site:airbnb.com/rooms "${c}"`,
      `site:airbnb.fr/rooms "${c}"`,
      `site:abritel.fr/location-vacances "${c}" particulier`,
      `"superhôte" "${c}" airbnb contact`,
      `hôte airbnb particulier ${c} contact`,
      `location airbnb particulier ${c} instagram`,
      `"Superhôte Airbnb" ${c} blog`,
      `airbnb host ${c} contact email`,
    );
  }

  // ─ Social discovery ─
  if (targetType === "all" || targetType === "concierges") {
    allWebFr.push(
      `site:instagram.com conciergerie Airbnb ${c}`,
      `site:instagram.com "location saisonnière" ${c}`,
      `site:linkedin.com/company conciergerie Airbnb ${c}`,
      `site:linkedin.com/company "location saisonnière" ${c}`,
      `site:facebook.com conciergerie Airbnb ${c}`,
    );
  }

  const allWebEn: string[] = [];

  if (targetType === "all" || targetType === "concierges" || targetType === "property_managers") {
    allWebEn.push(
      `Airbnb concierge ${c}`,
      `property manager Airbnb ${c}`,
      `short term rental management ${c}`,
      `Airbnb property management company ${c}`,
      `STR management company ${c}`,
      `vacation rental management company ${c}`,
      `"Airbnb management" ${c}`,
    );
  }

  if (targetType === "all" || targetType === "direct_owners") {
    allWebEn.push(
      `vacation rental ${c} owner contact`,
      `book direct ${c} vacation rental`,
      `direct booking ${c} Airbnb`,
      `holiday rental ${c} owner contact`,
      `"book direct" villa ${c}`,
    );
  }

  if (targetType === "all" || targetType === "agencies") {
    allWebEn.push(
      `vacation rental agency ${c}`,
      `holiday rental agency ${c}`,
      `Airbnb co-host ${c}`,
    );
  }

  if (targetType === "all") {
    allWebEn.push(
      `Airbnb superhost ${c}`,
      `site:instagram.com Airbnb ${c}`,
      `site:linkedin.com/company vacation rental ${c}`,
    );
  }

  const webQueries: string[] = fr
    ? [...allWebFr, ...allWebEn]
    : [...allWebEn, ...allWebFr];

  queries.webSearch = webQueries.slice(0, maxQueries);

  return queries;
}

export function detectLanguage(country: string): string {
  return isFrenchSpeaking(country) ? "fr" : "en";
}

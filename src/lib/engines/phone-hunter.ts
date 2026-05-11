// PHONE HUNTER — multi-method phone discovery for STR property owners
//
// Priority order (fastest / most reliable first):
//   1. Google Maps Place Details  — phone on verified business listing
//   2. Recherche Entreprises API  — French gov company registry, FREE, no key needed
//   3. Cross-platform OTA scan    — same property on Abritel/Gîtes/Leboncoin (show phones)
//   4. Pages Jaunes / Blanches    — SerpAPI snippet extraction
//   5. Direct web search          — phone pattern extraction from snippets + page fetch
//
// Hosts WITHOUT a website are flagged as priority targets — they are less contacted
// and more likely to need services like an AI concierge. Their leads get a score boost.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhoneResult {
  number: string;
  source: string;
  source_url?: string;
  method: string;
  confidence: "high" | "medium" | "low";
}

export interface PhoneHunterInput {
  operator_name?: string;
  host_name?: string;
  address?: string;
  city: string;
  country?: string;
  place_id?: string;
  siret?: string;
  has_website: boolean;
}

// ─── Phone extraction ─────────────────────────────────────────────────────────

// Matches: 06 12 34 56 78, +33 6 12 34 56 78, 0033612345678, 01.23.45.67.89
const PHONE_RE =
  /(?:(?:\+|00)33[\s.\-]?[1-9]|0[1-9])(?:[\s.\-]?\d{2}){4}/g;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s.\-]/g, "").replace(/^(?:\+|00)33/, "0");
  if (digits.length !== 10) return raw.trim();
  return digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4 $5");
}

function extractPhones(text: string): string[] {
  const phones: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(PHONE_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const normalized = normalizePhone(match[0]);
    if (normalized && !phones.includes(normalized)) {
      phones.push(normalized);
    }
  }
  return phones;
}

function bestConfidence(method: string): "high" | "medium" | "low" {
  if (method === "google_maps" || method === "recherche_entreprises") return "high";
  if (method === "abritel" || method === "gites_de_france" || method === "leboncoin") return "high";
  if (method === "pages_jaunes") return "medium";
  return "low";
}

// ─── Method 1: Google Maps Place Details ─────────────────────────────────────

export async function getPlacePhone(place_id: string): Promise<PhoneResult | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !place_id) return null;

  try {
    const params = new URLSearchParams({
      place_id,
      fields: "formatted_phone_number,international_phone_number",
      key,
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return null;

    const data = await res.json() as {
      result?: { formatted_phone_number?: string; international_phone_number?: string };
    };

    const phone =
      data.result?.formatted_phone_number ??
      data.result?.international_phone_number;
    if (!phone) return null;

    return {
      number: normalizePhone(phone),
      source: "Google Maps",
      method: "google_maps",
      confidence: "high",
    };
  } catch {
    return null;
  }
}

// ─── Method 2: Recherche Entreprises API (French gov, no key needed) ─────────

interface EntrepriseResult {
  nom_complet?: string;
  siege?: {
    telephone?: string;
    siret?: string;
    adresse?: string;
    code_postal?: string;
    commune?: string;
  };
  activite_principale?: string;
}

export async function searchEntreprises(
  query: string,
  codePostal?: string
): Promise<PhoneResult[]> {
  const results: PhoneResult[] = [];

  try {
    const params = new URLSearchParams({
      q: query.slice(0, 100),
      per_page: "10",
    });
    if (codePostal) params.set("code_postal", codePostal);

    const res = await fetch(
      `https://recherche-entreprises.api.gouv.fr/search?${params}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return [];

    const data = await res.json() as { results?: EntrepriseResult[] };

    for (const e of data.results ?? []) {
      const phone = e.siege?.telephone;
      if (phone) {
        const normalized = normalizePhone(phone);
        results.push({
          number: normalized,
          source: "Registre des Entreprises (gouv.fr)",
          method: "recherche_entreprises",
          confidence: "high",
        });
      }
    }
  } catch {
    // non-fatal
  }

  return results;
}

// ─── Method 3: Cross-platform OTA scan via SerpAPI ───────────────────────────

const OTA_SOURCES = [
  {
    method: "abritel",
    source: "Abritel",
    query: (name: string, city: string) =>
      `site:abritel.fr "${city}" "${name}" location vacances`,
  },
  {
    method: "gites_de_france",
    source: "Gîtes de France",
    query: (name: string, city: string) =>
      `site:gites-de-france.com "${city}" "${name}"`,
  },
  {
    method: "leboncoin",
    source: "Leboncoin",
    query: (name: string, city: string) =>
      `site:leboncoin.fr "${city}" location saisonnière "${name}"`,
  },
  {
    method: "clevacances",
    source: "Clévacances",
    query: (name: string, city: string) =>
      `site:clevacances.com "${city}" "${name}"`,
  },
] as const;

type OtaMethod = (typeof OTA_SOURCES)[number]["method"];

async function serpSearch(
  query: string
): Promise<Array<{ url: string; snippet: string; title: string }>> {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return [];

  try {
    const params = new URLSearchParams({
      api_key: key,
      engine: "google",
      q: query,
      gl: "fr",
      hl: "fr",
      num: "5",
    });
    const res = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      organic_results?: Array<{ link?: string; snippet?: string; title?: string }>;
    };
    return (data.organic_results ?? []).map((r) => ({
      url: r.link ?? "",
      snippet: r.snippet ?? "",
      title: r.title ?? "",
    }));
  } catch {
    return [];
  }
}

async function scanOTAPlatforms(
  name: string,
  city: string
): Promise<PhoneResult[]> {
  if (!process.env.SERPAPI_API_KEY) return [];

  const results: PhoneResult[] = [];

  for (const ota of OTA_SOURCES) {
    try {
      const serpResults = await serpSearch(ota.query(name, city));
      for (const r of serpResults) {
        const phones = extractPhones(`${r.snippet} ${r.title}`);
        for (const phone of phones) {
          results.push({
            number: phone,
            source: ota.source,
            source_url: r.url,
            method: ota.method as OtaMethod,
            confidence: "high",
          });
        }
      }
      await sleep(400);
    } catch {
      // per-platform errors are non-fatal
    }
  }

  return results;
}

// ─── Method 4: Pages Jaunes / Pages Blanches (SerpAPI snippet extraction) ────

async function searchPagesDirectory(
  name: string,
  city: string,
  individual: boolean
): Promise<PhoneResult[]> {
  if (!process.env.SERPAPI_API_KEY) return [];

  const site = individual ? "pagesblanche.fr" : "pagesjaunes.fr";
  const source = individual ? "Pages Blanches" : "Pages Jaunes";
  const method = individual ? "pages_blanches" : "pages_jaunes";

  try {
    const results = await serpSearch(`site:${site} "${name}" "${city}"`);
    const phones: PhoneResult[] = [];
    for (const r of results) {
      for (const phone of extractPhones(`${r.snippet} ${r.title}`)) {
        phones.push({
          number: phone,
          source,
          source_url: r.url,
          method,
          confidence: "medium",
        });
      }
    }
    return phones;
  } catch {
    return [];
  }
}

// ─── Method 5: Direct web search + fetch ─────────────────────────────────────

async function webSearchPhone(
  name: string,
  city: string
): Promise<PhoneResult[]> {
  if (!process.env.SERPAPI_API_KEY) return [];

  const results: PhoneResult[] = [];

  try {
    const query = `"${name}" "${city}" (téléphone OR contact OR "06" OR "07") location vacances`;
    const serpResults = await serpSearch(query);

    for (const r of serpResults) {
      // Extract from snippet first
      const snippetPhones = extractPhones(`${r.snippet} ${r.title}`);
      for (const phone of snippetPhones) {
        results.push({
          number: phone,
          source: r.title || "Web search",
          source_url: r.url,
          method: "web_search",
          confidence: "low",
        });
      }
    }

    // For the top result, fetch the actual page and extract phone
    const topUrl = serpResults[0]?.url;
    if (topUrl && results.length === 0) {
      try {
        const res = await fetch(topUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const html = await res.text();
          for (const phone of extractPhones(html.slice(0, 50_000))) {
            results.push({
              number: phone,
              source: serpResults[0].title || "Web page",
              source_url: topUrl,
              method: "web_fetch",
              confidence: "low",
            });
          }
        }
      } catch {
        // non-fatal
      }
    }
  } catch {
    // non-fatal
  }

  return results;
}

// ─── Address search on Leboncoin (no-website owners post here) ───────────────

async function searchByAddress(
  address: string,
  city: string
): Promise<PhoneResult[]> {
  if (!process.env.SERPAPI_API_KEY || !address) return [];

  const results: PhoneResult[] = [];
  const streetPart = address.split(",")[0]?.trim() ?? address;

  try {
    const serpResults = await serpSearch(
      `"${streetPart}" "${city}" location vacances particulier téléphone`
    );
    for (const r of serpResults) {
      for (const phone of extractPhones(`${r.snippet} ${r.title}`)) {
        results.push({
          number: phone,
          source: r.title || "Address search",
          source_url: r.url,
          method: "address_search",
          confidence: "medium",
        });
      }
    }
  } catch {
    // non-fatal
  }

  return results;
}

// ─── Main hunter ──────────────────────────────────────────────────────────────

export async function huntPhone(input: PhoneHunterInput): Promise<PhoneResult[]> {
  const {
    operator_name,
    host_name,
    address,
    city,
    place_id,
    siret,
    has_website,
  } = input;

  const allResults: PhoneResult[] = [];
  const seen = new Set<string>();

  function add(results: PhoneResult[]) {
    for (const r of results) {
      if (!seen.has(r.number)) {
        seen.add(r.number);
        allResults.push(r);
      }
    }
  }

  // Method 1: Google Maps Place Details (instant, highest quality)
  if (place_id) {
    const r = await getPlacePhone(place_id);
    if (r) add([r]);
  }

  if (allResults.length > 0) return allResults; // Got it from Maps — done

  const searchName = operator_name ?? host_name ?? city;

  // Method 2: French company registry (free, no key, great for registered operators)
  // Run regardless of website presence
  const postcode = address?.match(/\b\d{5}\b/)?.[0];
  if (searchName !== city) {
    add(await searchEntreprises(searchName + " " + city, postcode));
    await sleep(300);
  }
  if (siret) {
    add(await searchEntreprises(siret));
    await sleep(300);
  }

  if (allResults.length > 0) return allResults;

  // Methods 3-5: Only run if no phone yet or no website (= high priority target)
  // No-website hosts → run ALL methods (they're more likely to be reachable by phone)

  // Method 3: Cross-platform OTA scan
  if (searchName !== city) {
    add(await scanOTAPlatforms(searchName, city));
    await sleep(400);
  }

  if (!has_website || allResults.length === 0) {
    // Method 4a: Pages Jaunes (professional)
    if (operator_name) {
      add(await searchPagesDirectory(operator_name, city, false));
      await sleep(400);
    }
    // Method 4b: Pages Blanches (individual — specifically for hosts without businesses)
    if (host_name && !has_website) {
      add(await searchPagesDirectory(host_name, city, true));
      await sleep(400);
    }

    // Method 5a: Address search (very effective for individual owners)
    if (address) {
      add(await searchByAddress(address, city));
      await sleep(400);
    }

    // Method 5b: General web search
    if (searchName !== city) {
      add(await webSearchPhone(searchName, city));
    }
  }

  // Sort: high confidence first, then mobile numbers first (06/07 = private individuals)
  return allResults.sort((a, b) => {
    const confScore = { high: 3, medium: 2, low: 1 };
    const confDiff = confScore[b.confidence] - confScore[a.confidence];
    if (confDiff !== 0) return confDiff;
    // Mobile (06/07) first for individual hosts
    const aIsMobile = a.number.replace(/\s/g, "").startsWith("06") || a.number.replace(/\s/g, "").startsWith("07");
    const bIsMobile = b.number.replace(/\s/g, "").startsWith("06") || b.number.replace(/\s/g, "").startsWith("07");
    return (bIsMobile ? 1 : 0) - (aIsMobile ? 1 : 0);
  });
}

// ─── No-website detection ────────────────────────────────────────────────────
// These owners are HIGHER value — less reached, more likely to need our service

export function isHighOpportunityTarget(lead: {
  website_url?: string | null;
  source_type?: string;
}): boolean {
  return !lead.website_url && lead.source_type === "visual_reconstruction";
}

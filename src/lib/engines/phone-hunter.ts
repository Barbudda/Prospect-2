// PHONE HUNTER — multi-method phone discovery for STR property owners
//
// Priority order (fastest / most reliable first):
//   1. Google Maps Place Details  — phone on verified business listing
//   2. Recherche Entreprises API  — French gov company registry, FREE, no key needed
//   3. SIRENE GPS                 — French gov registry by location (auto-entrepreneurs)
//   4. Cross-platform OTA scan    — same property on Abritel/Gîtes/Leboncoin (host published)
//   5. Direct web search          — phone pattern extraction from snippets + page fetch
//
// Pages Jaunes / Pages Blanches are intentionally NOT queried programmatically — their
// ToS forbid automated/derivative use. End-users can still consult them manually.
//
// Hosts WITHOUT a website are flagged as priority targets — they are less contacted
// and more likely to need services like an AI concierge. Their leads get a score boost.

import { validateFrenchPhone } from "@/lib/utils/contact-validator";
import type { ExteriorSignals } from "@/lib/engines/exterior-text-miner";
import * as Router from "@/lib/providers/search-router";
import * as Abritel from "@/lib/providers/abritel-scraper";
import * as Clevacances from "@/lib/providers/clevacances-scraper";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhoneResult {
  number: string;
  source: string;
  source_url?: string;
  method: string;
  confidence: "high" | "medium" | "low";
  // Cross-validation against owner identity (0-100). Higher = more signals
  // (surname match, property-name match, regional phone code, multiple sources).
  validation_score?: number;
  validation_signals?: string[];
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
  // Website URL — when present, phone hunter crawls it directly. This is the
  // single highest-value signal for "operators who literally write their
  // phone number on their site". Method 1.5.
  website_url?: string;
  // GPS coordinates from geo-reconstruction — unlock address-based searches
  latitude?: number;
  longitude?: number;
  postal_code?: string;
  // Exterior signals mined from listing photos (Vision OCR → Mammouth classification)
  exterior_signals?: ExteriorSignals;
}

// ─── Phone extraction ─────────────────────────────────────────────────────────

// Matches: 06 12 34 56 78, +33 6 12 34 56 78, 0033612345678, 01.23.45.67.89
const PHONE_RE =
  /(?:(?:\+|00)33[\s.\-]?[1-9]|0[1-9])(?:[\s.\-]?\d{2}){4}/g;

// Wraps the strict French validator — returns null on invalid input
function normalizePhone(raw: string): string | null {
  return validateFrenchPhone(raw).cleaned ?? null;
}

function extractPhones(text: string): string[] {
  const phones: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(PHONE_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const clean = normalizePhone(match[0]);
    if (clean && !phones.includes(clean)) phones.push(clean);
  }
  return phones;
}

function bestConfidence(method: string): "high" | "medium" | "low" {
  if (method === "google_maps" || method === "recherche_entreprises") return "high";
  if (method === "abritel" || method === "gites_de_france" || method === "leboncoin") return "high";
  return "low";
}

// ─── Method 1.5: Crawl the operator's own website ───────────────────────────
//
// The single most-overlooked phone source: many operators literally write
// their number on their homepage / contact page. We crawl up to 8 common
// paths (homepage + /contact, /contactez-nous, /a-propos, /mentions-legales,
// /legal, etc.) with strict French phone validation. Highest confidence
// because the operator put the number there themselves.

async function scanOperatorWebsite(url: string): Promise<PhoneResult[]> {
  if (!url) return [];
  try {
    // Lazy import to avoid circular dep (contact-extractor uses validators
    // that import from this file's neighbours).
    const { extractContactsFromWebsite } = await import("@/lib/engines/contact-extractor");
    const contacts = await extractContactsFromWebsite(url, {
      maxPages: 8,
      timeoutMs: 12_000,
    });
    if (!contacts?.phones?.length) return [];

    const results: PhoneResult[] = [];
    for (const p of contacts.phones) {
      // Use whichever of raw / normalized actually passes our strict validator
      const candidates = [p.normalized, p.raw].filter(Boolean) as string[];
      let clean: string | null = null;
      for (const c of candidates) {
        const v = normalizePhone(c);
        if (v) {
          clean = v;
          break;
        }
      }
      if (!clean) continue;
      results.push({
        number: clean,
        source: "Operator website",
        source_url: p.source,
        method: "operator_website",
        confidence: p.confidence === "high" ? "high" : "medium",
      });
    }
    return results;
  } catch (err) {
    console.error("[phone-hunter] scanOperatorWebsite failed:", err instanceof Error ? err.message : err);
    return [];
  }
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

    const clean = normalizePhone(phone);
    if (!clean) return null;

    return {
      number: clean,
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
      if (!phone) continue;
      const clean = normalizePhone(phone);
      if (!clean) continue;
      results.push({
        number: clean,
        source: "Registre des Entreprises (gouv.fr)",
        method: "recherche_entreprises",
        confidence: "high",
      });
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

// Generic web search now goes through the router's allowlisted fallback,
// which refuses site:airbnb / site:abritel / site:gites-de-france /
// site:clevacances queries (those must use the direct scrapers).
async function serpSearch(
  query: string
): Promise<Array<{ url: string; snippet: string; title: string }>> {
  try {
    const results = await Router.fallbackWebSearch({ q: query, gl: "fr", hl: "fr", num: 5 });
    return results.map((r) => ({ url: r.url, snippet: r.snippet, title: r.title }));
  } catch {
    return [];
  }
}

async function scanOTAPlatforms(
  name: string,
  city: string
): Promise<PhoneResult[]> {
  if (!name || !city) return [];
  const results: PhoneResult[] = [];

  // ── Direct-scrape platforms — find owner's listings then read detail pages
  try {
    const directHits = await Router.searchByOwnerName({
      platform: "all",
      name,
      city,
      maxListingsPerPlatform: 5,
    });

    // For up to the first 3 hits, fetch detail pages to extract phones
    for (const listing of directHits.slice(0, 3)) {
      let phone: string | undefined;
      try {
        if (listing.source === "abritel") {
          const det = await Abritel.fetchListingDetail(listing.url);
          phone = det?.phone;
        } else if (listing.source === "clevacances") {
          const det = await Clevacances.fetchListingDetail(listing.url);
          phone = det?.phone;
        }
        // Gîtes de France doesn't typically expose phone on the public page.
      } catch {
        // detail fetch errors are non-fatal
      }
      if (phone) {
        const clean = normalizePhone(phone);
        if (clean) {
          results.push({
            number: clean,
            source: listing.source === "abritel" ? "Abritel" : listing.source === "clevacances" ? "Clévacances" : "Gîtes de France",
            source_url: listing.url,
            method: listing.source.replace(/-/g, "_") as OtaMethod,
            confidence: "high",
          });
        }
      }
      await sleep(200);
    }
  } catch (err) {
    console.error("[phone-hunter] direct OTA scan failed:", err instanceof Error ? err.message : err);
  }

  // ── Leboncoin — allowed via SerpAPI fallback (anti-bot too aggressive for direct scrape)
  try {
    const lbcQuery = `site:leboncoin.fr "${city}" location saisonnière "${name}"`;
    const lbcResults = await serpSearch(lbcQuery);
    for (const r of lbcResults) {
      const phones = extractPhones(`${r.snippet} ${r.title}`);
      for (const phone of phones) {
        results.push({
          number: phone,
          source: "Leboncoin",
          source_url: r.url,
          method: "leboncoin",
          confidence: "high",
        });
      }
    }
  } catch {
    // non-fatal
  }

  return results;
}

// ─── Method 2b: SIRENE GPS search (auto-entrepreneurs near the property) ─────
// Auto-entrepreneurs renting on Airbnb legally register with NAF 5520Z at their
// HOME address = the rental property. GPS + NAF finds them even without a name.

async function searchSIRENEByGPS(lat: number, lon: number): Promise<PhoneResult[]> {
  const NAF_CODES = ["5520Z", "6820A"]; // STR + residential rental
  const results: PhoneResult[] = [];

  for (const code_naf of NAF_CODES) {
    try {
      const params = new URLSearchParams({
        lat: lat.toFixed(6),
        lon: lon.toFixed(6),
        radius: "0.3", // 300m
        code_naf,
        per_page: "5",
      });
      const res = await fetch(
        `https://recherche-entreprises.api.gouv.fr/near_point?${params}`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) }
      );
      if (!res.ok) continue;

      const data = await res.json() as { results?: EntrepriseResult[] };
      for (const e of data.results ?? []) {
        const phone = e.siege?.telephone;
        if (!phone) continue;
        const clean = normalizePhone(phone);
        if (!clean) continue;
        results.push({
          number: clean,
          source: `SIRENE GPS — ${e.nom_complet ?? code_naf}`,
          method: "sirene_gps",
          confidence: "high",
        });
      }
      await sleep(200);
    } catch {
      // per NAF code — non-fatal
    }
  }

  return results;
}

// NOTE: Pages Jaunes / Pages Blanches are not queried programmatically.
// Their ToS forbid automated extraction / derivative reuse. End-users remain
// free to consult them manually via the source URLs surfaced elsewhere.

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

// ─── Method 6: Exterior surname search ───────────────────────────────────────
// Uses surname captured from a mailbox/doorbell/permit panel + the verified
// property address to search for the resident's number in public web results
// (forums, classifieds, local news mentioning the address). Pages Blanches is
// not queried directly (ToS-forbidden) but its content sometimes leaks into
// Google snippets and gets picked up here.

async function searchByExteriorSurname(
  surname: string,
  city: string,
  postalCode?: string
): Promise<PhoneResult[]> {
  if (!process.env.SERPAPI_API_KEY || !surname || surname.length < 2) return [];

  const results: PhoneResult[] = [];
  const cleanSurname = surname.trim().replace(/[^a-zA-ZÀ-ÿ\s\-']/g, "");
  const location = postalCode ? `${city} ${postalCode}` : city;

  try {
    const serpResults = await serpSearch(
      `"${cleanSurname}" "${location}" (téléphone OR tél OR mobile OR contact)`
    );
    for (const r of serpResults) {
      // Only keep phones from pages that actually mention the surname
      const pageText = `${r.title} ${r.snippet}`;
      if (!new RegExp(cleanSurname, "i").test(pageText)) continue;

      for (const phone of extractPhones(pageText)) {
        results.push({
          number: phone,
          source: `Web search — ${cleanSurname}`,
          source_url: r.url,
          method: "exterior_surname",
          confidence: "medium",
        });
      }
    }
  } catch {
    // non-fatal
  }
  return results;
}

// ─── Method 7: Property-name search ──────────────────────────────────────────
// Property name plaques like "Villa Les Hortensias" are SEO-friendly and often
// surface on regional tourism sites, gîte aggregators, owner's own social media.

async function searchByPropertyName(
  propertyName: string,
  city: string
): Promise<PhoneResult[]> {
  if (!process.env.SERPAPI_API_KEY || !propertyName) return [];

  const results: PhoneResult[] = [];
  try {
    const serpResults = await serpSearch(
      `"${propertyName}" "${city}" (contact OR téléphone OR réserver)`
    );
    for (const r of serpResults) {
      for (const phone of extractPhones(`${r.snippet} ${r.title}`)) {
        results.push({
          number: phone,
          source: `Property name — ${propertyName}`,
          source_url: r.url,
          method: "property_name",
          confidence: "medium",
        });
      }
    }
  } catch {
    // non-fatal
  }
  return results;
}

// ─── Cross-validation: score each candidate against owner identity signals ───
// "From the house to the owner, from the owner to candidate phones, from
//  candidate phones to THE phone" — this is the validation step.

const POSTAL_TO_PHONE_ZONE: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  // 01 — Île-de-France
  [75, 77, 78, 91, 92, 93, 94, 95].forEach((d) => (map[d] = "01"));
  // 02 — Nord-Ouest
  [14, 22, 27, 28, 29, 35, 36, 37, 41, 44, 45, 49, 50, 53, 56, 61, 72, 76, 85].forEach(
    (d) => (map[d] = "02")
  );
  // 03 — Nord-Est
  [2, 8, 10, 18, 21, 25, 39, 51, 52, 54, 55, 57, 58, 59, 60, 62, 67, 68, 70, 71, 80, 88, 89, 90].forEach(
    (d) => (map[d] = "03")
  );
  // 04 — Sud-Est
  [1, 3, 4, 5, 6, 7, 13, 15, 26, 30, 34, 38, 42, 43, 48, 63, 66, 69, 73, 74, 83, 84].forEach(
    (d) => (map[d] = "04")
  );
  // 05 — Sud-Ouest
  [9, 11, 12, 16, 17, 19, 23, 24, 31, 32, 33, 40, 46, 47, 64, 65, 79, 81, 82, 86, 87].forEach(
    (d) => (map[d] = "05")
  );
  return map;
})();

function expectedPhoneZoneForPostalCode(postal: string): string | null {
  const dept = parseInt(postal.slice(0, 2), 10);
  return Number.isFinite(dept) ? POSTAL_TO_PHONE_ZONE[dept] ?? null : null;
}

function crossValidatePhone(
  phone: PhoneResult,
  owner: {
    surnames: string[];
    property_names: string[];
    operator_name?: string;
    address?: string;
    postal_code?: string;
  },
  occurrenceCount: number
): PhoneResult {
  let score = 0;
  const signals: string[] = [];
  const digits = phone.number.replace(/\s/g, "");
  const haystack = (
    (phone.source ?? "") + " " + (phone.source_url ?? "")
  ).toLowerCase();

  // Mobile = strong signal for an individual host
  if (digits.startsWith("06") || digits.startsWith("07")) {
    score += 25;
    signals.push("mobile");
  }

  // Regional code matches expected zone for the postal code
  if (owner.postal_code) {
    const expected = expectedPhoneZoneForPostalCode(owner.postal_code);
    if (expected && digits.startsWith(expected)) {
      score += 20;
      signals.push(`region:${expected}`);
    } else if (expected && /^0[1-5]/.test(digits) && !digits.startsWith(expected)) {
      // Wrong region — landline outside expected zone is a red flag
      score -= 15;
      signals.push("region_mismatch");
    }
  }

  // The page hosting the phone mentions one of the owner's surnames
  for (const surname of owner.surnames) {
    if (surname && haystack.includes(surname.toLowerCase())) {
      score += 30;
      signals.push(`surname:${surname}`);
      break;
    }
  }

  // The page hosting the phone mentions the property name
  for (const propName of owner.property_names) {
    if (propName && haystack.includes(propName.toLowerCase())) {
      score += 25;
      signals.push("property_match");
      break;
    }
  }

  // The page mentions the operator's company name
  if (
    owner.operator_name &&
    haystack.includes(owner.operator_name.toLowerCase())
  ) {
    score += 15;
    signals.push("operator_match");
  }

  // Multiple independent sources surfaced the same number
  if (occurrenceCount >= 2) {
    score += Math.min(occurrenceCount * 10, 30);
    signals.push(`cross_source:${occurrenceCount}`);
  }

  // Boost trust from intrinsic source confidence
  if (phone.confidence === "high") score += 20;
  else if (phone.confidence === "medium") score += 10;

  return {
    ...phone,
    validation_score: Math.max(0, Math.min(100, score)),
    validation_signals: signals,
  };
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
    website_url,
    latitude,
    longitude,
    postal_code,
    exterior_signals,
  } = input;

  const allResults: PhoneResult[] = [];
  const occurrences = new Map<string, number>(); // number → count across methods
  const seen = new Set<string>();

  function add(results: PhoneResult[]) {
    for (const r of results) {
      occurrences.set(r.number, (occurrences.get(r.number) ?? 0) + 1);
      if (!seen.has(r.number)) {
        seen.add(r.number);
        allResults.push(r);
      }
    }
  }

  // Method 0: Phones directly captured by exterior OCR (signs, plaques)
  // — highest confidence: they're physically printed on the property
  if (exterior_signals?.visible_phones?.length) {
    for (const rawPhone of exterior_signals.visible_phones) {
      const validated = validateFrenchPhone(rawPhone);
      if (validated.valid && validated.cleaned) {
        add([
          {
            number: validated.cleaned,
            source: "Visible on exterior signage (OCR)",
            method: "exterior_visible",
            confidence: "high",
          },
        ]);
      }
    }
  }

  // Method 1: Google Maps Place Details (instant, highest quality)
  if (place_id) {
    const r = await getPlacePhone(place_id);
    if (r) add([r]);
  }

  // Method 1.5: Crawl the operator's own website — many operators literally
  // print their phone on their homepage / contact page. Strictly validated.
  if (website_url) {
    add(await scanOperatorWebsite(website_url));
    if (allResults.length > 0) return allResults;
  }

  if (allResults.length > 0) return allResults; // Got it from Maps — done

  const searchName = operator_name ?? host_name ?? city;

  // Method 2: French company registry by name (great for registered operators)
  const postcode = postal_code ?? address?.match(/\b\d{5}\b/)?.[0];
  if (searchName !== city) {
    add(await searchEntreprises(searchName + " " + city, postcode));
    await sleep(300);
  }
  if (siret) {
    add(await searchEntreprises(siret));
    await sleep(300);
  }

  // Method 2b: SIRENE GPS search — finds auto-entrepreneurs at the property address
  // Many Airbnb hosts register as auto-entrepreneurs with their home = rental address
  if (latitude !== undefined && longitude !== undefined) {
    add(await searchSIRENEByGPS(latitude, longitude));
    await sleep(300);
  }

  if (allResults.length > 0) return allResults;

  // Methods 3-7: Run when no phone found yet. Early-exit after each method
  // if we already have a high-confidence validated French phone, to save
  // API calls on the slower scrapers / web searches.
  const EARLY_EXIT_THRESHOLD = 1; // any result from high-confidence methods is enough

  // Method 3: Cross-platform OTA scan (direct scrapers + Leboncoin fallback)
  if (searchName !== city) {
    add(await scanOTAPlatforms(searchName, city));
    await sleep(400);
  }
  if (allResults.length >= EARLY_EXIT_THRESHOLD) return allResults;

  if (!has_website || allResults.length === 0) {
    // Method 4: Address search (web fallback)
    if (address) {
      add(await searchByAddress(address, city));
      await sleep(400);
    }
    if (allResults.length >= EARLY_EXIT_THRESHOLD) return allResults;

    // Method 5: General web search
    if (searchName !== city) {
      add(await webSearchPhone(searchName, city));
    }
    if (allResults.length >= EARLY_EXIT_THRESHOLD) return allResults;
  }

  // Method 6: Exterior surname search — surname from mailbox/permit + address
  if (exterior_signals?.surnames?.length) {
    for (const surname of exterior_signals.surnames.slice(0, 2)) {
      add(await searchByExteriorSurname(surname, city, postal_code));
      await sleep(400);
      if (allResults.length >= EARLY_EXIT_THRESHOLD) return allResults;
    }
  }

  // Method 7: Property-name search — gate plaque name often appears online
  if (exterior_signals?.property_names?.length) {
    for (const name of exterior_signals.property_names.slice(0, 2)) {
      add(await searchByPropertyName(name, city));
      await sleep(400);
    }
  }

  // Method 8: Permit panel — beneficiary's name is the legal property owner
  const permitName = exterior_signals?.permit_info?.beneficiary_name;
  if (permitName) {
    add(await searchByExteriorSurname(permitName, city, postal_code));
    await sleep(400);
  }

  // ── Cross-validation: score each candidate against owner identity ──────────
  // "From the house to the owner, from the owner to candidate phones, from
  //  candidate phones to THE phone" — owner signals validate each candidate.
  const ownerForValidation = {
    surnames: [
      ...(exterior_signals?.surnames ?? []),
      ...(exterior_signals?.permit_info?.beneficiary_name
        ? [exterior_signals.permit_info.beneficiary_name]
        : []),
    ],
    property_names: exterior_signals?.property_names ?? [],
    operator_name,
    address,
    postal_code,
  };

  const validated = allResults.map((p) =>
    crossValidatePhone(p, ownerForValidation, occurrences.get(p.number) ?? 1)
  );

  // Sort by validation_score (highest = most trustworthy), then by mobile-first
  return validated.sort((a, b) => {
    const scoreDiff = (b.validation_score ?? 0) - (a.validation_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const aIsMobile =
      a.number.replace(/\s/g, "").startsWith("06") ||
      a.number.replace(/\s/g, "").startsWith("07");
    const bIsMobile =
      b.number.replace(/\s/g, "").startsWith("06") ||
      b.number.replace(/\s/g, "").startsWith("07");
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

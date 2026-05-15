// Gîtes de France direct scraper.
// Central search → listing cards. Owner first name often visible ("Chez Marie").

import * as cheerio from "cheerio";
import { scrapeFetch, logScrape } from "./_scraper-utils";
import type { NormalizedListing } from "./listing-types";
import { getCached, setCached, makeKey } from "@/lib/cache/search-cache";

const LISTING_PATH_RE = /\/location[-_]vacances\/[a-z0-9\-]+\/(\d{4,})/gi;

export interface GitesSearchOpts {
  ttlSeconds?: number;
  maxListings?: number;
}

function buildSearchUrl(city: string): string {
  const q = encodeURIComponent(city.trim());
  return `https://www.gites-de-france.com/fr/recherche?text=${q}`;
}

export async function searchByCity(
  city: string,
  opts: GitesSearchOpts = {}
): Promise<NormalizedListing[]> {
  const ttl = opts.ttlSeconds ?? 7 * 24 * 60 * 60;
  const cap = Math.min(opts.maxListings ?? 50, 500);
  const cacheKey = makeKey(["gites:search", city]);

  const hit = getCached<NormalizedListing[]>(cacheKey);
  if (hit) {
    logScrape("gites-de-france", city, { status: 200, durationMs: 0, resultCount: hit.length, cacheHit: true });
    return hit.slice(0, cap);
  }

  const url = buildSearchUrl(city);
  const res = await scrapeFetch(url);

  if (!res.ok) {
    logScrape("gites-de-france", city, { status: res.status, durationMs: res.durationMs, resultCount: 0, cacheHit: false });
    return [];
  }

  const $ = cheerio.load(res.body);
  const byId = new Map<string, NormalizedListing>();

  $('a[href*="/location-vacances/"], a[href*="/location_vacances/"]').each((_i, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/\/location[-_]vacances\/[a-z0-9\-]+\/(\d{4,})/i);
    if (!m) return;
    const id = m[1];
    if (byId.has(id)) return;

    const title =
      $(a).find('h2, h3, [class*="title"]').first().text().trim() ||
      $(a).text().trim().slice(0, 120) ||
      "Gîte de France";

    // Host first name detection: "Chez Marie" pattern in/near the card
    const cardText = $(a).closest('[class*="card"], article, li').text();
    const hostMatch = cardText.match(/\bchez\s+([A-ZÀ-Ÿ][a-zà-ÿ\-]{2,25})\b/);

    const absUrl = href.startsWith("http") ? href : `https://www.gites-de-france.com${href}`;

    byId.set(id, {
      source: "gites-de-france",
      sourceListingId: id,
      url: absUrl,
      title: title.slice(0, 200),
      city,
      hostDisplayName: hostMatch?.[1],
      hostType: "particulier", // GdF is primarily individual owners
      photoUrls: [],
      scrapedAt: new Date().toISOString(),
    });
  });

  // Regex fallback
  for (const m of res.body.matchAll(LISTING_PATH_RE)) {
    const id = m[1];
    if (!byId.has(id)) {
      byId.set(id, {
        source: "gites-de-france",
        sourceListingId: id,
        url: `https://www.gites-de-france.com${m[0].split(/\/location[-_]vacances/i)[0]}/location-vacances/x/${id}`,
        title: "Gîte de France",
        city,
        hostType: "particulier",
        photoUrls: [],
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  const out = Array.from(byId.values()).slice(0, cap);
  setCached(cacheKey, out, ttl);
  logScrape("gites-de-france", city, { status: res.status, durationMs: res.durationMs, resultCount: out.length, cacheHit: false });
  return out;
}

export async function searchByOwnerName(
  name: string,
  city: string,
  opts: GitesSearchOpts = {}
): Promise<NormalizedListing[]> {
  if (!name || name.length < 2) return [];
  // GdF supports text search — pass the name as the search term.
  const cacheKey = makeKey(["gites:byowner", name, city]);
  const hit = getCached<NormalizedListing[]>(cacheKey);
  if (hit) return hit;

  const q = encodeURIComponent(`${name} ${city}`.trim());
  const url = `https://www.gites-de-france.com/fr/recherche?text=${q}`;
  const res = await scrapeFetch(url);
  if (!res.ok) return [];

  // Reuse the same parser as city search — same DOM shape
  const cityResults = await searchByCity(city, opts);
  const needle = name.toLowerCase();
  const out = cityResults.filter(
    (l) =>
      (l.hostDisplayName ?? "").toLowerCase().includes(needle) ||
      l.title.toLowerCase().includes(needle)
  );
  setCached(cacheKey, out, 30 * 24 * 60 * 60);
  return out;
}

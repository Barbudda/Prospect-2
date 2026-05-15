// Clévacances direct scraper. Standard server-rendered HTML; cheerio only.

import { scrapeFetch, logScrape } from "./_scraper-utils";
import type { NormalizedListing } from "./listing-types";
import { getCached, setCached, makeKey } from "@/lib/cache/search-cache";
import { validateFrenchPhone } from "@/lib/utils/contact-validator";

// Real URL pattern (probed 2026-05-15):
//   /fr/hebergement/<numericId>-<slug>?adults=0&children=0&babies=0&pets=0
// Previously assumed /fr/location-vacances/<...>/<id> — that 404s.
const LISTING_PATH_RE = /\/fr\/hebergement\/(\d{3,})-[a-z0-9\-]+/gi;

export interface ClevacancesSearchOpts {
  ttlSeconds?: number;
  maxListings?: number;
}

function buildSearchUrl(city: string): string {
  const q = encodeURIComponent(city.trim());
  return `https://www.clevacances.com/fr/recherche?text=${q}`;
}

export async function searchByCity(
  city: string,
  opts: ClevacancesSearchOpts = {}
): Promise<NormalizedListing[]> {
  const ttl = opts.ttlSeconds ?? 7 * 24 * 60 * 60;
  const cap = Math.min(opts.maxListings ?? 50, 500);
  const cacheKey = makeKey(["clevacances:search", city]);

  const hit = getCached<NormalizedListing[]>(cacheKey);
  if (hit) {
    logScrape("clevacances", city, { status: 200, durationMs: 0, resultCount: hit.length, cacheHit: true });
    return hit.slice(0, cap);
  }

  const url = buildSearchUrl(city);
  const res = await scrapeFetch(url);

  if (!res.ok) {
    logScrape("clevacances", city, { status: res.status, durationMs: res.durationMs, resultCount: 0, cacheHit: false });
    return [];
  }

  const listings = parseClevacancesSearchHtml(res.body, city);
  const out = listings.slice(0, cap);
  setCached(cacheKey, out, ttl);
  logScrape("clevacances", city, { status: res.status, durationMs: res.durationMs, resultCount: out.length, cacheHit: false });
  return out;
}

// Pure parser — exported for unit tests
export function parseClevacancesSearchHtml(html: string, city: string): NormalizedListing[] {
  const byId = new Map<string, NormalizedListing>();

  // Extract listing slugs via the corrected regex pattern, then read the
  // slug text to use as a placeholder title.
  for (const m of html.matchAll(LISTING_PATH_RE)) {
    const id = m[1];
    if (byId.has(id)) continue;
    const slugMatch = m[0].match(/\/(\d+)-([a-z0-9\-]+)/);
    const slug = slugMatch?.[2] ?? "";
    const title = slug
      ? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 200)
      : "Clévacances listing";

    byId.set(id, {
      source: "clevacances",
      sourceListingId: id,
      url: `https://www.clevacances.com${m[0]}`,
      title,
      city,
      hostType: "particulier",
      photoUrls: [],
      scrapedAt: new Date().toISOString(),
    });
  }
  return Array.from(byId.values());
}

export async function fetchListingDetail(
  listingUrl: string
): Promise<{ phone?: string; hostName?: string } | null> {
  const cacheKey = makeKey(["clevacances:detail", listingUrl]);
  const hit = getCached<{ phone?: string; hostName?: string }>(cacheKey);
  if (hit) return hit;

  const res = await scrapeFetch(listingUrl);
  if (!res.ok) return null;

  const phoneMatch = res.body.match(
    /(?:(?:\+|00)33[\s.\-]?[1-9]|0[1-9])(?:[\s.\-]?\d{2}){4}/
  );
  const phoneValidation = phoneMatch ? validateFrenchPhone(phoneMatch[0]) : null;
  const phone = phoneValidation?.valid ? phoneValidation.cleaned : undefined;

  const hostMatch = res.body.match(
    /(?:propriétaire|h[oô]te|chez)\s*[:\-]?\s*([A-ZÀ-Ÿ][a-zà-ÿ\-]{2,30})/
  );

  const result = { phone, hostName: hostMatch?.[1]?.trim() };
  setCached(cacheKey, result, 30 * 24 * 60 * 60);
  return result;
}

export async function searchByOwnerName(
  name: string,
  city: string,
  opts: ClevacancesSearchOpts = {}
): Promise<NormalizedListing[]> {
  if (!name || name.length < 2) return [];
  const cityResults = await searchByCity(city, opts);
  const needle = name.toLowerCase();
  return cityResults.filter(
    (l) =>
      l.title.toLowerCase().includes(needle) ||
      (l.hostDisplayName ?? "").toLowerCase().includes(needle)
  );
}

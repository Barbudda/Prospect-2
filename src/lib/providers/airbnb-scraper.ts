// Airbnb direct scraper.
// Search-by-city uses the public search page HTML (which embeds JSON state).
// Listing IDs surface as /rooms/<id> in href attributes; titles come from
// adjacent meta tags. Photos come from muscache CDN URLs embedded in the
// page. This is best-effort against the live DOM — selectors marked
// "SELECTOR: …" should be re-checked when Airbnb ships layout changes.

import { scrapeFetch, logScrape } from "./_scraper-utils";
import type { NormalizedListing } from "./listing-types";
import { getCached, setCached, makeKey } from "@/lib/cache/search-cache";

const MUSCACHE_RE = /https:\/\/a\d*\.muscache\.com\/im\/(?:pictures|photos)\/[^\s"'<>\\]+\.(?:jpg|jpeg|webp)/gi;
// Listing IDs are NOT in /rooms/<id> hrefs on the search page — that pattern
// appears 0× in the actual server-rendered HTML (probed 2026-05-15).
// Airbnb embeds the listing IDs inside its inline JSON state as
// "listingId":"<digits>" — that's the correct parse path.
const LISTING_ID_JSON_RE = /"listingId":"(\d{6,})"/g;
const LISTING_ID_ROOMS_RE = /\/rooms\/(\d{6,})(?:[/?"#]|$)/g;

export interface AirbnbSearchOpts {
  superhostOnly?: boolean;
  ttlSeconds?: number;     // override default 7-day cache
  maxListings?: number;
}

function buildSearchUrl(city: string, superhost: boolean): string {
  const path = encodeURIComponent(city.trim().replace(/\s+/g, "-"));
  const params = new URLSearchParams({ source: "structured_search_input" });
  if (superhost) params.set("superhost", "true");
  return `https://www.airbnb.com/s/${path}/homes?${params}`;
}

export async function searchByCity(
  city: string,
  opts: AirbnbSearchOpts = {}
): Promise<NormalizedListing[]> {
  const ttl = opts.ttlSeconds ?? 7 * 24 * 60 * 60;
  const cap = Math.min(opts.maxListings ?? 50, 500);
  const cacheKey = makeKey(["airbnb:search", city, opts.superhostOnly ? "sh" : ""]);

  const hit = getCached<NormalizedListing[]>(cacheKey);
  if (hit) {
    logScrape("airbnb", city, { status: 200, durationMs: 0, resultCount: hit.length, cacheHit: true });
    return hit.slice(0, cap);
  }

  const url = buildSearchUrl(city, Boolean(opts.superhostOnly));
  const res = await scrapeFetch(url, { acceptLanguage: "fr-FR,fr;q=0.9" });

  if (!res.ok) {
    logScrape("airbnb", city, { status: res.status, durationMs: res.durationMs, resultCount: 0, cacheHit: false });
    return [];
  }

  const listingsById = parseAirbnbSearchHtml(res.body, city);

  const out = listingsById.slice(0, cap);
  setCached(cacheKey, out, ttl);
  logScrape("airbnb", city, { status: res.status, durationMs: res.durationMs, resultCount: out.length, cacheHit: false });
  return out;
}

// Pure parser — exported so the unit tests can hit it directly on the fixture.
export function parseAirbnbSearchHtml(html: string, city: string): NormalizedListing[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(LISTING_ID_JSON_RE)) ids.add(m[1]);
  // Fallback: /rooms/<id> hrefs (rare on the search page but present elsewhere)
  for (const m of html.matchAll(LISTING_ID_ROOMS_RE)) ids.add(m[1]);

  const photos = Array.from(new Set(Array.from(html.matchAll(MUSCACHE_RE)).map((m) => m[0])));

  const out: NormalizedListing[] = [];
  for (const id of ids) {
    out.push({
      source: "airbnb",
      sourceListingId: id,
      url: `https://www.airbnb.com/rooms/${id}`,
      title: "Airbnb listing",
      city,
      photoUrls: photos.slice(0, 6),
      scrapedAt: new Date().toISOString(),
    });
  }
  return out;
}

// Airbnb host search by name is not supported via a public endpoint.
// We return an empty array — the router falls back to a generic web search
// scoped to airbnb.com via the allowlisted SerpAPI fallback when appropriate.
export async function searchByOwnerName(
  _name: string,
  _city: string
): Promise<NormalizedListing[]> {
  return [];
}

// Fetch one listing detail page for richer metadata (photos, listing title).
export async function fetchListingDetail(
  listingUrl: string
): Promise<{ photos: string[]; title?: string; hostFirstName?: string } | null> {
  const cacheKey = makeKey(["airbnb:detail", listingUrl]);
  const hit = getCached<{ photos: string[]; title?: string; hostFirstName?: string }>(cacheKey);
  if (hit) return hit;

  const res = await scrapeFetch(listingUrl, { acceptLanguage: "fr-FR,fr;q=0.9" });
  if (!res.ok) return null;

  const photos = Array.from(new Set(Array.from(res.body.matchAll(MUSCACHE_RE)).map((m) => m[0])));
  const titleMatch = res.body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const hostMatch = res.body.match(/(?:hosted|animé|géré) by ([A-Za-zÀ-ÿ\-' ]{2,30})/i);

  const result = {
    photos: photos.slice(0, 10),
    title: titleMatch?.[1],
    hostFirstName: hostMatch?.[1]?.trim(),
  };
  setCached(cacheKey, result, 14 * 24 * 60 * 60);
  return result;
}

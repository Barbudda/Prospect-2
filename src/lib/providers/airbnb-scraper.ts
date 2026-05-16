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
// Listing IDs are NOT in /rooms/<id> hrefs on the search page (re-probed
// 2026-05-16: 0×). Airbnb embeds search results as `StaySearchResult` JSON
// blocks; each block carries its listing ID inside picture URLs of the
// form `/Hosting-<id>/` *and* via the `"listingId":"<id>"` field. Either
// pattern works, but `Hosting-<id>` is co-located with the rating data
// (`avgRatingLocalized` like `"4,98 (126)"`) so we parse per-block to
// pair listing ID, rating, and review count.
const LISTING_ID_JSON_RE = /"listingId":"(\d{6,})"/g;
const LISTING_ID_ROOMS_RE = /\/rooms\/(\d{6,})(?:[/?"#]|$)/g;
const STAY_RESULT_BLOCK_RE = /"__typename":"StaySearchResult"[\s\S]{0,6000}?(?="__typename":"StaySearchResult"|"__typename":"StaysSearch[A-Z])/g;
const HOSTING_PIC_ID_RE = /\/Hosting-(\d{6,})\//;
const AVG_RATING_RE = /"avgRatingLocalized":"([\d,.]+)\s*\((\d+)\)"/;
const AVG_RATING_LABEL_RE = /"avgRatingA11yLabel":"[^"]*?(\d[\d., ]+)\s*(?:commentaires?|avis|reviews?)[^"]*"/i;
const PRICE_HINT_RE = /"price":"(\d[\d  ., ]{0,12})\s*([€$£])/;
const SUPERHOST_BADGE_RE = /"badgeType":"SUPERHOST"|"text":"Superh(?:ote|ôte|ost)"/i;

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
  const scrapedAt = new Date().toISOString();
  // Pass 1: walk each StaySearchResult block and try to extract the trio of
  // (listing ID, rating, reviewCount). This is the high-signal path — every
  // block that yields an ID comes with co-located review data.
  const seen = new Map<string, NormalizedListing>();
  for (const blockMatch of html.matchAll(STAY_RESULT_BLOCK_RE)) {
    const block = blockMatch[0];
    const idMatch = HOSTING_PIC_ID_RE.exec(block);
    const id = idMatch?.[1];
    if (!id || seen.has(id)) continue;

    let rating: number | undefined;
    let reviewCount: number | undefined;
    const ratingMatch = AVG_RATING_RE.exec(block);
    if (ratingMatch) {
      rating = parseFloat(ratingMatch[1].replace(",", "."));
      reviewCount = parseInt(ratingMatch[2], 10);
    } else {
      // Fallback to the accessible label — French/English variant
      const labelMatch = AVG_RATING_LABEL_RE.exec(block);
      if (labelMatch) {
        reviewCount = parseInt(labelMatch[1].replace(/\D/g, ""), 10);
      }
    }

    const isSuperhost = SUPERHOST_BADGE_RE.test(block);
    const priceMatch = PRICE_HINT_RE.exec(block);
    const priceHint = priceMatch
      ? (() => {
          const amt = parseFloat(priceMatch[1].replace(/[^\d.]/g, "."));
          return Number.isFinite(amt) ? { amount: amt, currency: priceMatch[2], per: "night" as const } : undefined;
        })()
      : undefined;

    const photos = Array.from(block.matchAll(MUSCACHE_RE)).map((m) => m[0]).slice(0, 6);

    // Title is intentionally minimal and per-listing-unique. The structured
    // review / Superhost signals travel on the dedicated fields below; we
    // don't bake them into the title so downstream UIs can render a clean
    // label.
    seen.set(id, {
      source: "airbnb",
      sourceListingId: id,
      url: `https://www.airbnb.com/rooms/${id}`,
      title: `Airbnb #${id.slice(-6)}`,
      city,
      photoUrls: photos,
      reviewCount,
      rating,
      isSuperhost,
      priceHint,
      scrapedAt,
    });
  }

  // Pass 2: catch any listing IDs that surface outside StaySearchResult
  // blocks (e.g. carousel / wishlist sections). These come without review
  // metadata, so we add them only if we haven't yet collected any results.
  if (seen.size === 0) {
    const fallbackIds = new Set<string>();
    for (const m of html.matchAll(LISTING_ID_JSON_RE)) fallbackIds.add(m[1]);
    for (const m of html.matchAll(LISTING_ID_ROOMS_RE)) fallbackIds.add(m[1]);
    const photos = Array.from(html.matchAll(MUSCACHE_RE)).map((m) => m[0]).slice(0, 6);
    for (const id of fallbackIds) {
      seen.set(id, {
        source: "airbnb",
        sourceListingId: id,
        url: `https://www.airbnb.com/rooms/${id}`,
        title: `Airbnb #${id.slice(-6)}`,
        city,
        photoUrls: photos,
        scrapedAt,
      });
    }
  }

  return Array.from(seen.values());
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

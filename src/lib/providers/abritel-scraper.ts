// Abritel (Vrbo France) direct scraper.
// Search results page is server-rendered HTML.

import * as cheerio from "cheerio";
import { scrapeFetch, logScrape } from "./_scraper-utils";
import type { NormalizedListing, HostType } from "./listing-types";
import { getCached, setCached, makeKey } from "@/lib/cache/search-cache";
import { validateFrenchPhone } from "@/lib/utils/contact-validator";

const LISTING_PATH_RE = /\/location-vacances\/p?(\d{4,})/g;

export interface AbritelSearchOpts {
  hostType?: HostType;     // filter: "particulier" only
  ttlSeconds?: number;
  maxListings?: number;
}

function buildSearchUrl(city: string): string {
  const q = encodeURIComponent(city.trim());
  return `https://www.abritel.fr/search?q=${q}`;
}

export async function searchByCity(
  city: string,
  opts: AbritelSearchOpts = {}
): Promise<NormalizedListing[]> {
  const ttl = opts.ttlSeconds ?? 7 * 24 * 60 * 60;
  const cap = Math.min(opts.maxListings ?? 50, 500);
  const cacheKey = makeKey(["abritel:search", city, opts.hostType ?? ""]);

  const hit = getCached<NormalizedListing[]>(cacheKey);
  if (hit) {
    logScrape("abritel", city, { status: 200, durationMs: 0, resultCount: hit.length, cacheHit: true });
    return hit.slice(0, cap);
  }

  const url = buildSearchUrl(city);
  const res = await scrapeFetch(url);

  if (!res.ok) {
    logScrape("abritel", city, { status: res.status, durationMs: res.durationMs, resultCount: 0, cacheHit: false });
    return [];
  }

  const $ = cheerio.load(res.body);
  const byId = new Map<string, NormalizedListing>();

  // Cards: anchors to /location-vacances/p<id>
  $('a[href*="/location-vacances/"]').each((_i, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/\/location-vacances\/p?(\d{4,})/);
    if (!m) return;
    const id = m[1];
    if (byId.has(id)) return;

    const title =
      $(a).find('[class*="title"], h2, h3').first().text().trim() ||
      $(a).attr("aria-label") ||
      "Abritel listing";

    const absUrl = href.startsWith("http") ? href : `https://www.abritel.fr${href}`;

    byId.set(id, {
      source: "abritel",
      sourceListingId: id,
      url: absUrl,
      title: title.slice(0, 200),
      city,
      photoUrls: [],
      scrapedAt: new Date().toISOString(),
    });
  });

  // Regex fallback for IDs the cheerio pass missed
  for (const m of res.body.matchAll(LISTING_PATH_RE)) {
    const id = m[1];
    if (!byId.has(id)) {
      byId.set(id, {
        source: "abritel",
        sourceListingId: id,
        url: `https://www.abritel.fr/location-vacances/p${id}`,
        title: "Abritel listing",
        city,
        photoUrls: [],
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  const out = Array.from(byId.values()).slice(0, cap);
  setCached(cacheKey, out, ttl);
  logScrape("abritel", city, { status: res.status, durationMs: res.durationMs, resultCount: out.length, cacheHit: false });
  return out;
}

// Fetch a single listing detail page to extract host_type and phone.
export async function fetchListingDetail(
  listingUrl: string
): Promise<{ hostType: HostType; phone?: string; hostName?: string } | null> {
  const cacheKey = makeKey(["abritel:detail", listingUrl]);
  const hit = getCached<{ hostType: HostType; phone?: string; hostName?: string }>(cacheKey);
  if (hit) return hit;

  const res = await scrapeFetch(listingUrl);
  if (!res.ok) return null;

  const html = res.body.toLowerCase();
  const hostType: HostType =
    /particulier/.test(html) ? "particulier"
    : /professionnel|pro\b/.test(html) ? "pro"
    : "unknown";

  const phoneMatch = res.body.match(
    /(?:(?:\+|00)33[\s.\-]?[1-9]|0[1-9])(?:[\s.\-]?\d{2}){4}/
  );
  const phoneValidation = phoneMatch ? validateFrenchPhone(phoneMatch[0]) : null;
  const phone = phoneValidation?.valid ? phoneValidation.cleaned : undefined;

  const hostNameMatch = res.body.match(
    /(?:propriétaire|h[oô]te|chez)\s*[:\-]?\s*([A-ZÀ-Ÿ][a-zà-ÿ\-]{2,30}(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ\-]{2,30})?)/
  );

  const result = {
    hostType,
    phone,
    hostName: hostNameMatch?.[1]?.trim(),
  };
  setCached(cacheKey, result, 30 * 24 * 60 * 60);
  return result;
}

export async function searchByOwnerName(
  name: string,
  city: string,
  opts: AbritelSearchOpts = {}
): Promise<NormalizedListing[]> {
  if (!name || name.length < 2) return [];
  // Abritel doesn't support owner-name search natively. We do a city search
  // and filter results whose title/host matches the name.
  const cityResults = await searchByCity(city, { ...opts, maxListings: 200 });
  const needle = name.toLowerCase();
  return cityResults.filter(
    (l) =>
      l.title.toLowerCase().includes(needle) ||
      (l.hostDisplayName ?? "").toLowerCase().includes(needle)
  );
}

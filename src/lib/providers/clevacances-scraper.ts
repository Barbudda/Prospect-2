// Clévacances direct scraper. Standard server-rendered HTML; cheerio only.

import * as cheerio from "cheerio";
import { scrapeFetch, logScrape } from "./_scraper-utils";
import type { NormalizedListing } from "./listing-types";
import { getCached, setCached, makeKey } from "@/lib/cache/search-cache";
import { validateFrenchPhone } from "@/lib/utils/contact-validator";

const LISTING_PATH_RE = /\/location[-_]vacances\/[^\/\s"']+\/[^\/\s"']+\/(\d{4,})/gi;

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

  const $ = cheerio.load(res.body);
  const byId = new Map<string, NormalizedListing>();

  $('a[href*="/location"]').each((_i, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/\/(\d{4,})(?:[\/?#]|$)/);
    if (!m) return;
    const id = m[1];
    if (byId.has(id)) return;

    const title =
      $(a).find('h2, h3, [class*="title"]').first().text().trim() ||
      $(a).text().trim().slice(0, 120) ||
      "Clévacances";

    const absUrl = href.startsWith("http") ? href : `https://www.clevacances.com${href}`;

    byId.set(id, {
      source: "clevacances",
      sourceListingId: id,
      url: absUrl,
      title: title.slice(0, 200),
      city,
      hostType: "particulier",
      photoUrls: [],
      scrapedAt: new Date().toISOString(),
    });
  });

  for (const m of res.body.matchAll(LISTING_PATH_RE)) {
    const id = m[1];
    if (!byId.has(id)) {
      byId.set(id, {
        source: "clevacances",
        sourceListingId: id,
        url: `https://www.clevacances.com${m[0]}`,
        title: "Clévacances listing",
        city,
        hostType: "particulier",
        photoUrls: [],
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  const out = Array.from(byId.values()).slice(0, cap);
  setCached(cacheKey, out, ttl);
  logScrape("clevacances", city, { status: res.status, durationMs: res.durationMs, resultCount: out.length, cacheHit: false });
  return out;
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

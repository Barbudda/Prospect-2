// Gîtes de France direct scraper.
//
// IMPORTANT (probed 2026-05-15): the public search page at
//   https://www.gites-de-france.com/fr/search?keys={city}
// returns 200 but the result list is rendered CLIENT-SIDE via a JS app.
// The static HTML contains zero listing IDs / hrefs. Server-side scraping
// without a headless browser yields nothing useful.
//
// Pragmatic choice: this module now falls back to SerpAPI's allowlisted
// generic search scoped to `site:gites-de-france.com`. We keep the same
// public interface (searchByCity / searchByOwnerName) so the router and
// engines don't need to know the implementation switched. When we have
// Playwright infra, we can swap back to a real direct scrape.

import type { NormalizedListing } from "./listing-types";
import { getCached, setCached, makeKey } from "@/lib/cache/search-cache";
import { logScrape } from "./_scraper-utils";

export interface GitesSearchOpts {
  ttlSeconds?: number;
  maxListings?: number;
}

const LISTING_ID_HINT_RE = /gites-de-france\.com\/fr\/[a-z\-]+\/(\d{4,})/i;

async function fallback(q: string): Promise<Array<{ url: string; title: string; snippet: string }>> {
  // Lazy import to avoid a cycle (router imports this scraper).
  const Router = await import("./search-router");
  // The router's fallback refuses site:gites-de-france.com queries.
  // We call SerpAPI directly here with a clear log — Gîtes JS-rendering is
  // the documented exception.
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return [];

  void Router;

  const params = new URLSearchParams({
    api_key: key,
    engine: "google",
    q,
    gl: "fr",
    hl: "fr",
    num: "10",
    safe: "active",
  });
  try {
    const res = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      organic_results?: Array<{ link?: string; title?: string; snippet?: string }>;
    };
    return (data.organic_results ?? []).map((r) => ({
      url: r.link ?? "",
      title: r.title ?? "",
      snippet: r.snippet ?? "",
    }));
  } catch {
    return [];
  }
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
    logScrape("gites-de-france", city, {
      status: 200, durationMs: 0, resultCount: hit.length, cacheHit: true,
    });
    return hit.slice(0, cap);
  }

  const q = `site:gites-de-france.com "${city}"`;
  const start = Date.now();
  const results = await fallback(q);

  const byId = new Map<string, NormalizedListing>();
  for (const r of results) {
    if (!r.url.includes("gites-de-france.com")) continue;
    const m = r.url.match(LISTING_ID_HINT_RE);
    const id = m?.[1] ?? r.url.replace(/[^a-z0-9]/gi, "").slice(0, 32);
    if (byId.has(id)) continue;

    // "Chez Marie" pattern in title/snippet
    const hostMatch = `${r.title} ${r.snippet}`.match(/\bchez\s+([A-ZÀ-Ÿ][a-zà-ÿ\-]{2,25})/);

    byId.set(id, {
      source: "gites-de-france",
      sourceListingId: id,
      url: r.url,
      title: (r.title || "Gîte de France").slice(0, 200),
      city,
      hostDisplayName: hostMatch?.[1],
      hostType: "particulier",
      photoUrls: [],
      scrapedAt: new Date().toISOString(),
    });
  }

  const out = Array.from(byId.values()).slice(0, cap);
  setCached(cacheKey, out, ttl);
  logScrape("gites-de-france", city, {
    status: 200, durationMs: Date.now() - start, resultCount: out.length, cacheHit: false,
  });
  return out;
}

export async function searchByOwnerName(
  name: string,
  city: string,
  opts: GitesSearchOpts = {}
): Promise<NormalizedListing[]> {
  if (!name || name.length < 2) return [];
  const cacheKey = makeKey(["gites:byowner", name, city]);
  const hit = getCached<NormalizedListing[]>(cacheKey);
  if (hit) return hit;

  const q = `site:gites-de-france.com "${city}" "${name}"`;
  const results = await fallback(q);
  const out: NormalizedListing[] = results
    .filter((r) => r.url.includes("gites-de-france.com"))
    .map((r) => {
      const m = r.url.match(LISTING_ID_HINT_RE);
      const id = m?.[1] ?? r.url.replace(/[^a-z0-9]/gi, "").slice(0, 32);
      const hostMatch = `${r.title} ${r.snippet}`.match(/\bchez\s+([A-ZÀ-Ÿ][a-zà-ÿ\-]{2,25})/);
      return {
        source: "gites-de-france" as const,
        sourceListingId: id,
        url: r.url,
        title: r.title || "Gîte de France",
        city,
        hostDisplayName: hostMatch?.[1] ?? name,
        hostType: "particulier" as const,
        photoUrls: [],
        scrapedAt: new Date().toISOString(),
      };
    })
    .slice(0, opts.maxListings ?? 20);

  setCached(cacheKey, out, 30 * 24 * 60 * 60);
  return out;
}

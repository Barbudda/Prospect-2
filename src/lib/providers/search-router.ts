// Search router — single entry point for every "find listings / find phones"
// call in the project. Engines should call this, not individual scrapers.

import * as Airbnb from "./airbnb-scraper";
import * as Abritel from "./abritel-scraper";
import * as Gites from "./gites-de-france-scraper";
import * as Clevacances from "./clevacances-scraper";
import type { NormalizedListing, ListingSource, WebSnippet } from "./listing-types";
import { logScrape } from "./_scraper-utils";

// ─── Direct-scraper platforms ────────────────────────────────────────────────

export interface SearchListingsOpts {
  platform: ListingSource | "all";
  city: string;
  q?: string;                                 // free-text filter (optional)
  filters?: { superhost?: boolean; hostType?: "particulier" | "pro" };
  maxListingsPerPlatform?: number;
}

export async function searchListings(
  opts: SearchListingsOpts
): Promise<NormalizedListing[]> {
  const targets: ListingSource[] =
    opts.platform === "all"
      ? ["airbnb", "abritel", "gites-de-france", "clevacances"]
      : [opts.platform];

  const cap = opts.maxListingsPerPlatform ?? 50;
  const results: NormalizedListing[] = [];

  for (const platform of targets) {
    try {
      if (platform === "airbnb") {
        results.push(
          ...(await Airbnb.searchByCity(opts.city, {
            superhostOnly: opts.filters?.superhost,
            maxListings: cap,
          }))
        );
      } else if (platform === "abritel") {
        results.push(
          ...(await Abritel.searchByCity(opts.city, {
            hostType: opts.filters?.hostType,
            maxListings: cap,
          }))
        );
      } else if (platform === "gites-de-france") {
        results.push(...(await Gites.searchByCity(opts.city, { maxListings: cap })));
      } else if (platform === "clevacances") {
        results.push(...(await Clevacances.searchByCity(opts.city, { maxListings: cap })));
      }
    } catch (err) {
      console.error(`[router] ${platform} search failed:`, err instanceof Error ? err.message : err);
    }
  }

  // Optional free-text post-filter
  if (opts.q) {
    const needle = opts.q.toLowerCase();
    return results.filter(
      (l) =>
        l.title.toLowerCase().includes(needle) ||
        (l.hostDisplayName ?? "").toLowerCase().includes(needle)
    );
  }
  return results;
}

export interface SearchByOwnerOpts {
  platform: ListingSource | "all";
  name: string;
  city: string;
  maxListingsPerPlatform?: number;
}

export async function searchByOwnerName(
  opts: SearchByOwnerOpts
): Promise<NormalizedListing[]> {
  if (!opts.name || opts.name.length < 2) return [];

  const targets: ListingSource[] =
    opts.platform === "all"
      ? ["abritel", "gites-de-france", "clevacances"]
      : [opts.platform];

  const out: NormalizedListing[] = [];
  for (const p of targets) {
    try {
      if (p === "airbnb") out.push(...(await Airbnb.searchByOwnerName(opts.name, opts.city)));
      else if (p === "abritel")
        out.push(...(await Abritel.searchByOwnerName(opts.name, opts.city)));
      else if (p === "gites-de-france")
        out.push(...(await Gites.searchByOwnerName(opts.name, opts.city)));
      else if (p === "clevacances")
        out.push(...(await Clevacances.searchByOwnerName(opts.name, opts.city)));
    } catch (err) {
      console.error(`[router] ${p} owner-search failed:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

// ─── Allowlisted web fallback (SerpAPI under tight constraints) ───────────────
// Used for queries no direct scraper can handle: surname + city, address,
// Leboncoin (anti-bot too aggressive for direct scraping), generic news
// mentions. Rejects `site:` operators that target our directly-scraped
// platforms — those MUST go through the router's direct path.

const SCRAPED_HOSTS = ["airbnb.", "abritel.fr", "gites-de-france.com", "clevacances.com"];

const ALLOWED_SITE_OPERATORS = [
  "leboncoin.fr",
  "pap.fr",
  "seloger.com",
  "pagesjaunes.fr",
  "118712.fr",
  "lefigaro.fr",
  "sudouest.fr",
  "ledauphine.com",
  "ouest-france.fr",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
];

export interface FallbackWebSearchOpts {
  q: string;
  gl?: string;
  hl?: string;
  num?: number;
}

export async function fallbackWebSearch(
  opts: FallbackWebSearchOpts
): Promise<WebSnippet[]> {
  // Refusal check FIRST — structural error regardless of SerpAPI config.
  const siteMatch = opts.q.match(/\bsite:([^\s]+)/i);
  if (siteMatch) {
    const host = siteMatch[1].toLowerCase();
    if (SCRAPED_HOSTS.some((s) => host.includes(s))) {
      throw new Error(
        `Router refused fallbackWebSearch: site:${host} must go through the direct scraper, not SerpAPI.`
      );
    }
    if (!ALLOWED_SITE_OPERATORS.some((s) => host.includes(s))) {
      console.warn(`[router] fallback web search using non-allowlisted site: ${host}`);
    }
  }

  const key = process.env.SERPAPI_API_KEY;
  if (!key) return [];

  const params = new URLSearchParams({
    api_key: key,
    engine: "google",
    q: opts.q,
    gl: opts.gl ?? "fr",
    hl: opts.hl ?? "fr",
    num: String(Math.min(opts.num ?? 5, 10)),
    safe: "active",
  });

  const start = Date.now();
  try {
    const res = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      logScrape("serpapi-fallback", opts.q, {
        status: res.status,
        durationMs: Date.now() - start,
        resultCount: 0,
        cacheHit: false,
      });
      return [];
    }
    const data = (await res.json()) as {
      organic_results?: Array<{ link?: string; title?: string; snippet?: string }>;
    };
    const snippets = (data.organic_results ?? []).map<WebSnippet>((r) => ({
      url: r.link ?? "",
      title: r.title ?? "",
      snippet: r.snippet ?? "",
      source: "web",
    }));
    logScrape("serpapi-fallback", opts.q, {
      status: res.status,
      durationMs: Date.now() - start,
      resultCount: snippets.length,
      cacheHit: false,
    });
    return snippets;
  } catch (err) {
    console.error("[router] fallbackWebSearch failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

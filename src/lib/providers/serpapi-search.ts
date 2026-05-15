import type { SearchProvider, SearchResult } from "@/lib/types";

// SerpAPI generic Google search — now used ONLY as a residual fallback for
// queries that no direct platform scraper can handle. Queries containing a
// `site:` operator targeting a directly-scraped platform (airbnb, abritel,
// gites-de-france, clevacances) are rejected here so a developer can't
// accidentally route through SerpAPI when the router exists.

const SCRAPED_HOSTS = ["airbnb.", "abritel.fr", "gites-de-france.com", "clevacances.com"];

export class SerpAPISearchProvider implements SearchProvider {
  readonly name = "SerpAPI";

  isConfigured(): boolean {
    return Boolean(process.env.SERPAPI_API_KEY);
  }

  async search(
    query: string,
    country: string,
    language: string,
    limit: number
  ): Promise<SearchResult[]> {
    if (!this.isConfigured()) return [];

    // Refuse queries that target our directly-scraped platforms
    const siteMatch = query.match(/\bsite:([^\s]+)/i);
    if (siteMatch && SCRAPED_HOSTS.some((s) => siteMatch[1].toLowerCase().includes(s))) {
      console.warn(
        `[SerpAPI] Refused query (use the direct scraper / router instead): ${query.slice(0, 120)}`
      );
      return [];
    }

    const params = new URLSearchParams({
      api_key: process.env.SERPAPI_API_KEY!,
      engine: "google",
      q: query,
      gl: this.countryCode(country),
      hl: language,
      num: String(Math.min(limit, 10)),
      safe: "active",
    });

    const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`SerpAPI HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const results: SearchResult[] = [];

    for (const item of data.organic_results ?? []) {
      if (item.link && item.title) {
        results.push({
          title: item.title,
          url: item.link,
          snippet: item.snippet ?? "",
          source_url: item.link,
        });
      }
    }

    return results.slice(0, limit);
  }

  private countryCode(country: string): string {
    const map: Record<string, string> = {
      france: "fr",
      "united kingdom": "gb",
      uk: "gb",
      spain: "es",
      italy: "it",
      germany: "de",
      portugal: "pt",
      usa: "us",
      "united states": "us",
    };
    return map[country.toLowerCase().trim()] ?? "fr";
  }
}

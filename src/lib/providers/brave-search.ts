import type { SearchProvider, SearchResult } from "@/lib/types";

export class BraveSearchProvider implements SearchProvider {
  readonly name = "Brave Search";

  isConfigured(): boolean {
    return Boolean(process.env.BRAVE_SEARCH_API_KEY);
  }

  async search(
    query: string,
    country: string,
    language: string,
    limit: number
  ): Promise<SearchResult[]> {
    if (!this.isConfigured()) return [];

    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(limit, 20)),
      country: this.countryCode(country),
      search_lang: language,
      safesearch: "moderate",
    });

    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY!,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Brave Search HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const results: SearchResult[] = [];

    for (const item of data.web?.results ?? []) {
      if (item.url && item.title) {
        results.push({
          title: item.title,
          url: item.url,
          snippet: item.description ?? "",
          source_url: item.url,
        });
      }
    }

    return results.slice(0, limit);
  }

  private countryCode(country: string): string {
    const map: Record<string, string> = {
      france: "FR",
      "united kingdom": "GB",
      uk: "GB",
      spain: "ES",
      italy: "IT",
      germany: "DE",
      portugal: "PT",
      usa: "US",
      "united states": "US",
    };
    return map[country.toLowerCase().trim()] ?? "FR";
  }
}

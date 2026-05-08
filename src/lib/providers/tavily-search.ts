import type { SearchProvider, SearchResult } from "@/lib/types";

export class TavilySearchProvider implements SearchProvider {
  readonly name = "Tavily";

  isConfigured(): boolean {
    return Boolean(process.env.TAVILY_API_KEY);
  }

  async search(
    query: string,
    country: string,
    language: string,
    limit: number
  ): Promise<SearchResult[]> {
    if (!this.isConfigured()) return [];

    const body = {
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      max_results: Math.min(limit, 10),
    };

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Tavily HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const results: SearchResult[] = [];

    for (const item of data.results ?? []) {
      if (item.url && item.title) {
        results.push({
          title: item.title,
          url: item.url,
          snippet: item.content ?? item.description ?? "",
          source_url: item.url,
        });
      }
    }

    return results.slice(0, limit);
  }
}

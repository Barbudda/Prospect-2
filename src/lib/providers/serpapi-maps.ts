import type { LocalBusinessProvider, RawBusinessResult } from "@/lib/types";

export class SerpAPIMapsProvider implements LocalBusinessProvider {
  readonly name = "SerpAPI Maps";

  isConfigured(): boolean {
    return Boolean(process.env.SERPAPI_API_KEY);
  }

  async searchBusinesses(
    query: string,
    location: string,
    country: string,
    limit: number
  ): Promise<RawBusinessResult[]> {
    if (!this.isConfigured()) return [];

    const params = new URLSearchParams({
      api_key: process.env.SERPAPI_API_KEY!,
      engine: "google_maps",
      q: `${query} ${location}`,
      type: "search",
    });

    const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`SerpAPI Maps HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const results: RawBusinessResult[] = [];

    for (const item of data.local_results ?? []) {
      const website: string | undefined = item.website ?? undefined;
      const mapsUrl: string | undefined =
        item.place_id_search ??
        (item.data_id
          ? `https://www.google.com/maps/search/?q=place_id:${item.data_id}`
          : undefined);

      // source_url must be non-empty (required by DB schema)
      const source_url =
        website ??
        mapsUrl ??
        `https://www.google.com/maps/search/?q=${encodeURIComponent(item.title ?? query)}+${encodeURIComponent(location)}`;

      results.push({
        business_name: item.title ?? "",
        category: item.type ?? "",
        website,
        phone: item.phone ?? undefined,
        address: item.address ?? undefined,
        rating: item.rating ?? undefined,
        review_count: item.reviews ?? undefined,
        google_maps_url: mapsUrl,
        source_url,
        location,
        raw_provider_payload: item,
      });
    }

    return results.slice(0, limit);
  }
}

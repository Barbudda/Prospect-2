import type { LocalBusinessProvider, RawBusinessResult } from "@/lib/types";

export class GooglePlacesProvider implements LocalBusinessProvider {
  readonly name = "Google Places";

  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_PLACES_API_KEY);
  }

  async searchBusinesses(
    query: string,
    location: string,
    country: string,
    limit: number
  ): Promise<RawBusinessResult[]> {
    if (!this.isConfigured()) return [];

    // Use Text Search endpoint
    const params = new URLSearchParams({
      query: `${query} ${location}`,
      key: process.env.GOOGLE_PLACES_API_KEY!,
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`,
      { signal: AbortSignal.timeout(15_000) }
    );

    if (!res.ok) {
      throw new Error(`Google Places HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      throw new Error(`Google Places error: ${data.status} — ${data.error_message ?? ""}`);
    }

    const results: RawBusinessResult[] = [];

    for (const place of (data.results ?? []).slice(0, limit)) {
      const mapsUrl = place.place_id
        ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
        : undefined;

      results.push({
        business_name: place.name ?? "",
        category: (place.types ?? []).join(", "),
        address: place.formatted_address ?? undefined,
        rating: place.rating ?? undefined,
        review_count: place.user_ratings_total ?? undefined,
        google_maps_url: mapsUrl,
        source_url: mapsUrl ?? "",
        location,
        raw_provider_payload: place,
      });
    }

    // Fetch website/phone for each place via Details endpoint — in parallel
    const DETAIL_BATCH = 5;
    const enriched: RawBusinessResult[] = [];
    for (let i = 0; i < results.length; i += DETAIL_BATCH) {
      const batch = results.slice(i, i + DETAIL_BATCH);
      const details = await Promise.allSettled(
        batch.map(async (r) => {
          const payload = r.raw_provider_payload as Record<string, unknown>;
          const placeId = payload?.place_id as string | undefined;
          if (!placeId) return r;
          try {
            const det = await this.fetchDetails(placeId);
            return { ...r, website: det.website, phone: det.phone };
          } catch {
            return r;
          }
        })
      );
      for (const d of details) {
        enriched.push(d.status === "fulfilled" ? d.value : batch[details.indexOf(d)]);
      }
    }

    return enriched.filter((r) => r.source_url);
  }

  private async fetchDetails(
    placeId: string
  ): Promise<{ website?: string; phone?: string }> {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "website,formatted_phone_number",
      key: process.env.GOOGLE_PLACES_API_KEY!,
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return {};
    const data = await res.json();
    return {
      website: data.result?.website,
      phone: data.result?.formatted_phone_number,
    };
  }
}

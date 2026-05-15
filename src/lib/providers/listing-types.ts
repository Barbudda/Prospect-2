// Normalised cross-platform listing shape. Every scraper returns this.

export type ListingSource =
  | "airbnb"
  | "abritel"
  | "gites-de-france"
  | "clevacances"
  | "leboncoin"
  | "web";

export type HostType = "particulier" | "pro" | "unknown";

export interface NormalizedListing {
  source: ListingSource;
  sourceListingId: string;
  url: string;
  title: string;
  city: string;
  hostDisplayName?: string;
  hostType?: HostType;
  phone?: string;          // already validated by validateFrenchPhone
  email?: string;
  priceHint?: { amount: number; currency: string; per: "night" | "week" };
  photoUrls: string[];
  scrapedAt: string;       // ISO timestamp
  raw?: unknown;
}

// Snippet shape returned by the residual web fallback (not a listing).
export interface WebSnippet {
  url: string;
  title: string;
  snippet: string;
  source: "web";
}

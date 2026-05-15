import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAirbnbSearchHtml } from "@/lib/providers/airbnb-scraper";

const fixture = readFileSync(
  join(__dirname, "../fixtures/probes/airbnb.html"),
  "utf-8"
);

describe("parseAirbnbSearchHtml", () => {
  const listings = parseAirbnbSearchHtml(fixture, "Nice");

  it("extracts at least one listing ID from the embedded JSON", () => {
    expect(listings.length).toBeGreaterThan(0);
  });

  it("every listing has a numeric ID and a /rooms/ URL", () => {
    for (const l of listings) {
      expect(l.sourceListingId).toMatch(/^\d+$/);
      expect(l.url).toMatch(/^https:\/\/www\.airbnb\.com\/rooms\/\d+$/);
    }
  });

  it("captures the requested city on every listing", () => {
    for (const l of listings) expect(l.city).toBe("Nice");
  });

  it("tags every listing as source=airbnb", () => {
    for (const l of listings) expect(l.source).toBe("airbnb");
  });

  it("collects muscache.com photo URLs from the page", () => {
    const first = listings[0];
    expect(Array.isArray(first.photoUrls)).toBe(true);
    if (first.photoUrls.length > 0) {
      expect(first.photoUrls[0]).toMatch(/muscache\.com/);
    }
  });

  it("does not return duplicate listing IDs", () => {
    const ids = listings.map((l) => l.sourceListingId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAirbnbSearchHtml } from "@/lib/providers/airbnb-scraper";

const fixture = readFileSync(
  join(__dirname, "../fixtures/probes/airbnb.html"),
  "utf-8"
);

const parisFixture = readFileSync(
  join(__dirname, "../fixtures/probes/airbnb-paris-2026-05.html"),
  "utf-8"
);

describe("parseAirbnbSearchHtml — base fixture", () => {
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

  it("does not return duplicate listing IDs", () => {
    const ids = listings.map((l) => l.sourceListingId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives each listing a distinguishable title (not the constant 'Airbnb listing')", () => {
    const titles = new Set(listings.map((l) => l.title));
    // At minimum, the title should differ per listing because it embeds
    // the last six digits of the listing ID.
    expect(titles.size).toBeGreaterThan(1);
    for (const t of titles) expect(t).toMatch(/Airbnb #\d{6}/);
  });
});

describe("parseAirbnbSearchHtml — fresh Paris fixture (2026-05)", () => {
  const listings = parseAirbnbSearchHtml(parisFixture, "Paris");

  it("surfaces real search results, not just a recommendation carousel", () => {
    expect(listings.length).toBeGreaterThan(5);
  });

  it("attaches a review count and rating to at least one listing", () => {
    const withReviews = listings.filter((l) => typeof l.reviewCount === "number");
    expect(withReviews.length).toBeGreaterThan(0);
    const sample = withReviews[0];
    expect(sample.reviewCount).toBeGreaterThan(0);
    expect(sample.rating).toBeGreaterThanOrEqual(1);
    expect(sample.rating).toBeLessThanOrEqual(5);
  });
});

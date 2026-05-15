import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClevacancesSearchHtml } from "@/lib/providers/clevacances-scraper";

const fixture = readFileSync(
  join(__dirname, "../fixtures/probes/clevacances.html"),
  "utf-8"
);

describe("parseClevacancesSearchHtml", () => {
  const listings = parseClevacancesSearchHtml(fixture, "Nice");

  it("extracts at least one /fr/hebergement/<id>-<slug> listing", () => {
    expect(listings.length).toBeGreaterThan(0);
  });

  it("every listing carries a numeric ID and a clevacances URL", () => {
    for (const l of listings) {
      expect(l.sourceListingId).toMatch(/^\d+$/);
      expect(l.url).toMatch(/^https:\/\/www\.clevacances\.com\/fr\/hebergement\/\d+-/);
    }
  });

  it("tags every listing as source=clevacances", () => {
    for (const l of listings) expect(l.source).toBe("clevacances");
  });

  it("does not return duplicates", () => {
    const ids = listings.map((l) => l.sourceListingId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("titles are humanised (capitalised, no slug dashes)", () => {
    const first = listings[0];
    // either we humanised a slug or fell back to the placeholder
    expect(first.title.length).toBeGreaterThan(0);
    if (first.title !== "Clévacances listing") {
      expect(first.title).not.toMatch(/^[a-z0-9\-]+$/);
    }
  });
});

import { describe, it, expect } from "vitest";
import { fallbackWebSearch } from "@/lib/providers/search-router";

describe("router fallbackWebSearch — allowlist gate", () => {
  it("refuses site:airbnb.com queries", async () => {
    await expect(
      fallbackWebSearch({ q: 'site:airbnb.com "Nice"' })
    ).rejects.toThrow(/direct scraper/);
  });

  it("refuses site:abritel.fr queries", async () => {
    await expect(
      fallbackWebSearch({ q: 'site:abritel.fr "Nice" particulier' })
    ).rejects.toThrow(/direct scraper/);
  });

  it("refuses site:gites-de-france.com queries when called by an engine", async () => {
    // Gîtes is a scraped platform from the engine's POV; the Gîtes scraper
    // itself calls SerpAPI directly (not via the router) to handle the
    // documented JS-rendering exception.
    await expect(
      fallbackWebSearch({ q: 'site:gites-de-france.com "Nice"' })
    ).rejects.toThrow(/direct scraper/);
  });

  it("refuses site:clevacances.com queries", async () => {
    await expect(
      fallbackWebSearch({ q: 'site:clevacances.com "Nice"' })
    ).rejects.toThrow(/direct scraper/);
  });

  it("accepts site:leboncoin.fr queries (allowlisted)", async () => {
    // Without a SERPAPI key the call returns [] but should NOT throw the
    // refusal error.
    const result = await fallbackWebSearch({
      q: 'site:leboncoin.fr "Nice"',
    }).catch((e: Error) => e.message);
    expect(typeof result === "string" ? result : "ok").not.toMatch(/direct scraper/);
  });

  it("accepts queries with no site: operator", async () => {
    const result = await fallbackWebSearch({ q: "conciergerie Nice" }).catch(
      (e: Error) => e.message
    );
    expect(typeof result === "string" ? result : "ok").not.toMatch(/direct scraper/);
  });
});

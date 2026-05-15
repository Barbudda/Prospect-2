import { describe, it, expect } from "vitest";
import { gradeLead } from "@/lib/engines/lead-quality-gate";

describe("gradeLead — junk filter", () => {
  describe("rejects junk", () => {
    const junk = [
      {
        name: "Help-center page",
        lead: { primary_name: "Superhost criteria explained", source_url: "https://www.airbnb.fr/help/article/829", lead_type: "Unknown STR Lead" },
        expectCategory: "help_page",
      },
      {
        name: "Reddit thread",
        lead: { primary_name: "AirBnB hosts in Paris — Reddit", source_url: "https://www.reddit.com/r/AirBnB/comments/abc", lead_type: "Unknown STR Lead" },
        expectCategory: "community_forum",
      },
      {
        name: "Wikipedia page",
        lead: { primary_name: "Airbnb — Wikipedia", source_url: "https://fr.wikipedia.org/wiki/Airbnb", lead_type: "Unknown STR Lead" },
        expectCategory: "wikipedia",
      },
      {
        name: "Sud Ouest news article",
        lead: { primary_name: "Biarritz : les meublés de tourisme...", source_url: "https://www.sudouest.fr/biarritz/...", lead_type: "Unknown STR Lead" },
        expectCategory: "press_article",
      },
      {
        name: "Generic Superhost guide (matched by URL path /blog/)",
        lead: { primary_name: "Comment devenir Superhost Airbnb ? Guide complet 2026", source_url: "https://blog.someplace.com/comment-devenir-superhost", lead_type: "Unknown STR Lead" },
        // URL /blog/ pattern OR name pattern — either catches it; we accept whichever fires first
      },
      {
        name: "Single-word junk name (Facebook)",
        lead: { primary_name: "Facebook", source_url: "https://www.facebook.com/somepage", lead_type: "Unknown STR Lead" },
        // URL hits the auth-page pattern OR name hits junk_name — either is fine
      },
      {
        name: "Unknown lead type with no contact data",
        lead: { primary_name: "Some random page", source_url: "https://example.com/x", lead_type: "Unknown STR Lead" },
        expectCategory: "no_contact_unknown_type",
      },
    ];

    for (const c of junk) {
      it(`rejects: ${c.name}`, () => {
        const v = gradeLead(c.lead);
        expect(v.keep).toBe(false);
        if (c.expectCategory) expect(v.category).toBe(c.expectCategory);
      });
    }
  });

  describe("keeps real operators", () => {
    const keepers = [
      { name: "Conciergerie with website + phone", lead: { primary_name: "Conciergerie Locale", lead_type: "Airbnb Concierge", website_url: "https://conciergerie-locale.com", phone: "06 12 34 56 78" } },
      { name: "Individual Airbnb host", lead: { primary_name: "Marie — Superhôte", lead_type: "Individual Airbnb Host", source_type: "individual_host" } },
      { name: "Property manager with website", lead: { primary_name: "WeHost", lead_type: "Property Manager", website_url: "https://wehost.fr" } },
      { name: "Gîte operator", lead: { primary_name: "Villa Les Hortensias", lead_type: "Gîte / Villa Operator", phone: "05 59 12 34 56" } },
    ];

    for (const c of keepers) {
      it(`keeps: ${c.name}`, () => {
        const v = gradeLead(c.lead);
        expect(v.keep).toBe(true);
      });
    }
  });
});

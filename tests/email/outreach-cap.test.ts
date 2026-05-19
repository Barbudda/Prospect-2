import { describe, it, expect } from "vitest";
import { checkPerLeadCap, checkPerDomainCap } from "@/lib/utils/outreach-cap";

const ISO = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86_400_000;

describe("checkPerLeadCap", () => {
  it("allows a lead with no prior outreach", () => {
    expect(checkPerLeadCap(null).allowed).toBe(true);
    expect(checkPerLeadCap(undefined).allowed).toBe(true);
    expect(checkPerLeadCap("").allowed).toBe(true);
  });

  it("allows a lead whose last contact is older than the cap", () => {
    const r = checkPerLeadCap(ISO(91 * DAY));
    expect(r.allowed).toBe(true);
    expect(r.days_since_last).toBeGreaterThanOrEqual(91);
  });

  it("refuses a lead contacted yesterday", () => {
    const r = checkPerLeadCap(ISO(1 * DAY));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Per-lead frequency cap/);
    expect(r.retry_after).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.days_since_last).toBe(1);
  });

  it("refuses a lead contacted exactly 89 days ago", () => {
    expect(checkPerLeadCap(ISO(89 * DAY)).allowed).toBe(false);
  });

  it("allows a lead contacted exactly 90 days ago", () => {
    expect(checkPerLeadCap(ISO(90 * DAY)).allowed).toBe(true);
  });

  it("respects a custom cap value", () => {
    expect(checkPerLeadCap(ISO(15 * DAY), 30).allowed).toBe(false);
    expect(checkPerLeadCap(ISO(31 * DAY), 30).allowed).toBe(true);
  });

  it("tolerates a garbage timestamp without crashing", () => {
    expect(checkPerLeadCap("not a date").allowed).toBe(true);
  });
});

describe("checkPerDomainCap", () => {
  it("allows when no recent contacts share the target's domain", () => {
    expect(
      checkPerDomainCap({
        email: "hugo@example.fr",
        recent_contacts: [
          { email: "alice@other.com" },
          { email: "bob@yet-another.io" },
        ],
      }).allowed
    ).toBe(true);
  });

  it("counts both email and website_url toward the same domain", () => {
    const r = checkPerDomainCap({
      website_url: "https://example.fr/contact",
      recent_contacts: [
        { email: "a@example.fr" },
        { email: "b@example.fr" },
        { email: "c@example.fr" },
        { email: "d@example.fr" },
        { website_url: "https://www.example.fr" },
      ],
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/example\.fr/);
  });

  it("does NOT cross-pollinate www.example.fr vs example.fr", () => {
    // extractDomain strips a leading `www.` so both should match the
    // same canonical domain; this asserts that behaviour.
    const r = checkPerDomainCap({
      email: "hugo@example.fr",
      recent_contacts: Array.from({ length: 5 }, () => ({ website_url: "https://www.example.fr" })),
    });
    expect(r.allowed).toBe(false);
  });

  it("allows when target has no resolvable domain", () => {
    expect(
      checkPerDomainCap({ email: null, website_url: null, recent_contacts: [] }).allowed
    ).toBe(true);
  });

  it("respects custom cap value", () => {
    const contacts = Array.from({ length: 3 }, () => ({ email: "x@example.fr" }));
    expect(checkPerDomainCap({ email: "y@example.fr", recent_contacts: contacts }, 2).allowed).toBe(false);
    expect(checkPerDomainCap({ email: "y@example.fr", recent_contacts: contacts }, 5).allowed).toBe(true);
  });
});

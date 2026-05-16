import { describe, it, expect } from "vitest";
import { validatePhone, findPhonesInText } from "@/lib/utils/contact-validator";

describe("validatePhone — international coverage", () => {
  const accepted: Array<{ input: string; country?: string; defaultCountry?: "FR" | "GB" | "DE" | "ES" | "IT" | "US" | "AU"; e164?: string }> = [
    // France
    { input: "+33 6 12 34 56 78", country: "FR", e164: "+33612345678" },
    { input: "06 12 34 56 78", country: "FR", defaultCountry: "FR", e164: "+33612345678" },
    { input: "+33 (0)5 59 74 10 32", country: "FR", e164: "+33559741032" },
    // United Kingdom
    { input: "+44 20 7946 0958", country: "GB", e164: "+442079460958" },
    { input: "020 7946 0958", country: "GB", defaultCountry: "GB", e164: "+442079460958" },
    { input: "+44 7400 123456", country: "GB" },                         // mobile
    // Germany
    { input: "+49 30 12345678", country: "DE" },
    { input: "030 12345678", country: "DE", defaultCountry: "DE" },
    // Spain
    { input: "+34 612 345 678", country: "ES" },
    // Italy
    { input: "+39 02 1234 5678", country: "IT" },
    // United States / Canada (NANP)
    { input: "+1 415 555 0132", country: "US" },
    { input: "(415) 555-0132", country: "US", defaultCountry: "US" },
    // Switzerland
    { input: "+41 44 668 18 00", country: "CH" },
    // Belgium
    { input: "+32 2 123 45 67", country: "BE" },
    // Australia
    { input: "+61 2 9374 4000", country: "AU" },
  ];

  for (const c of accepted) {
    const country = c.defaultCountry ?? "FR";
    it(`accepts ${c.input} (country=${country})`, () => {
      const r = validatePhone(c.input, country);
      expect(r.valid).toBe(true);
      if (c.country) expect(r.country).toBe(c.country);
      if (c.e164) expect(r.e164).toBe(c.e164);
    });
  }

  const rejected = [
    { input: "1234", reason: /length|invalid/ },
    { input: "0000000000", reason: /repeating|invalid/ },
    { input: "11111111111", reason: /repeating|invalid|length/ },
    { input: "+33 8 92 70 21 80", reason: /special_rate_08/ },
    { input: "20240115", reason: /date_pattern|invalid|length|ambiguous/ },
  ];
  for (const c of rejected) {
    it(`rejects ${c.input}`, () => {
      const r = validatePhone(c.input, "FR");
      expect(r.valid).toBe(false);
      expect(r.reason ?? "").toMatch(c.reason);
    });
  }
});

describe("findPhonesInText — extracts every well-formed number from a free-text blob", () => {
  it("extracts multiple international numbers in one pass", () => {
    const text = "Reach our London office on +44 20 7946 0958 or Paris on +33 (0)5 59 74 10 32. NYC: +1 415 555 0132.";
    const out = findPhonesInText(text, "FR");
    const e164s = out.map((p) => p.e164);
    expect(e164s).toContain("+442079460958");
    expect(e164s).toContain("+33559741032");
    expect(e164s).toContain("+14155550132");
  });

  it("respects defaultCountry for local-form numbers", () => {
    const out = findPhonesInText("Call 020 7946 0958 from anywhere.", "GB");
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].country).toBe("GB");
  });

  it("skips garbage", () => {
    const out = findPhonesInText("Order ID 1234567 was processed on 2024-01-15.", "FR");
    expect(out.length).toBe(0);
  });

  it("dedupes the same number written different ways", () => {
    const text = "Call us at +33 6 12 34 56 78 or 06.12.34.56.78 — same line.";
    const out = findPhonesInText(text, "FR");
    expect(out.length).toBe(1);
  });
});

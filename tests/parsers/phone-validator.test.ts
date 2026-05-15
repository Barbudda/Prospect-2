import { describe, it, expect } from "vitest";
import { validateFrenchPhone } from "@/lib/utils/contact-validator";

describe("validateFrenchPhone — write-style coverage", () => {
  const cases: Array<{ input: string; expected: boolean; cleaned?: string; note?: string }> = [
    // Canonical formats
    { input: "06 12 34 56 78", expected: true, cleaned: "06 12 34 56 78" },
    { input: "0612345678", expected: true, cleaned: "06 12 34 56 78", note: "no separators" },
    { input: "06.12.34.56.78", expected: true, note: "dots" },
    { input: "06-12-34-56-78", expected: true, note: "hyphens" },
    // International
    { input: "+33 6 12 34 56 78", expected: true, cleaned: "06 12 34 56 78" },
    { input: "+33612345678", expected: true },
    { input: "0033 6 12 34 56 78", expected: true },
    // The big one — "(0)" inside international format
    { input: "+33 (0)5 59 74 10 32", expected: true, cleaned: "05 59 74 10 32", note: "PARENTHESISED ZERO" },
    { input: "+33(0)612345678", expected: true, note: "no space variant" },
    { input: "+33-(0)-5-59-74-10-32", expected: true, note: "hyphenated with (0)" },
    // URL-encoded
    { input: "%2B33%205%2059%2051%2000%2000", expected: true, note: "URL-encoded" },
    // HTML-entity encoded
    { input: "+3&#51; 6 12 34 56 78", expected: true, note: "entity-encoded digit" },
    // Rejections — strict
    { input: "5475 21.23", expected: false, note: "too short" },
    { input: "077133191", expected: false, note: "9 digits" },
    { input: "+330535455800", expected: false, note: "12 digits with +33 = invalid" },
    { input: "134217728", expected: false, note: "JS constant 2^27" },
    { input: "0892 702 180", expected: false, note: "premium-rate 08xx" },
    { input: "0000000000", expected: false, note: "all zeros" },
  ];

  for (const c of cases) {
    it(`${c.expected ? "accepts" : "rejects"}: ${JSON.stringify(c.input)}${c.note ? " — " + c.note : ""}`, () => {
      const r = validateFrenchPhone(c.input);
      expect(r.valid).toBe(c.expected);
      if (c.expected && c.cleaned) {
        expect(r.cleaned).toBe(c.cleaned);
      }
    });
  }
});

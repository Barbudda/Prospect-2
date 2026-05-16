import { describe, it, expect } from "vitest";
import { extractPhonesFromHtml, extractEmailsFromHtml } from "@/lib/engines/contact-extractor";

// Round 3: real-world edge cases that broke the previous extractor.
// Run these against the new libphonenumber-backed pipeline to catch
// anything still slipping through.

describe("extractPhonesFromHtml — entity-encoded + unicode separators", () => {
  it("decodes &#43;33 / &#43;44 entity-encoded plus signs", () => {
    const html = `<p>FR: &#43;33 6 12 34 56 78  ·  UK: &#43;44 20 7946 0958</p>`;
    const e164s = extractPhonesFromHtml(html, "https://example.com/contact").map((p) => p.normalized);
    expect(e164s).toContain("+33612345678");
    expect(e164s).toContain("+442079460958");
  });

  it("handles unicode non-breaking-space (U+00A0) separators", () => {
    // Real sites often serialise nbsp between digit groups
    const html = `<p>+33 6 12 34 56 78</p>`;
    const e164s = extractPhonesFromHtml(html, "https://example.com/contact").map((p) => p.normalized);
    expect(e164s).toContain("+33612345678");
  });

  it("handles unicode narrow-no-break-space (U+202F) — French phone convention", () => {
    const html = `<p>+33 6 12 34 56 78</p>`;
    const e164s = extractPhonesFromHtml(html, "https://example.com/contact").map((p) => p.normalized);
    expect(e164s).toContain("+33612345678");
  });

  it("handles em-dash separators that French web designers love", () => {
    const html = `<p>Tél : 01 — 47 — 23 — 45 — 67</p>`;
    const e164s = extractPhonesFromHtml(html, "https://example.com/contact").map((p) => p.normalized);
    expect(e164s).toContain("+33147234567");
  });

  it("picks up plain '+33 6 12 34 56 78' from a div that uses spans for every digit group", () => {
    const html = `<div><span>+33</span> <span>6</span> <span>12</span> <span>34</span> <span>56</span> <span>78</span></div>`;
    const e164s = extractPhonesFromHtml(html, "https://example.com/contact").map((p) => p.normalized);
    expect(e164s).toContain("+33612345678");
  });

  it("does not double-count the same number written in international AND local form", () => {
    const html = `<p>Call us: +33 6 12 34 56 78 or 06 12 34 56 78 — same number.</p>`;
    const phones = extractPhonesFromHtml(html, "https://example.com/contact");
    const distinct = new Set(phones.map((p) => p.normalized));
    expect(distinct.size).toBe(1);
  });
});

describe("extractPhonesFromHtml — junk that must be rejected", () => {
  it("rejects French SIREN/SIRET-shaped digit runs even without an explicit RCS prefix", () => {
    // No prefix, just a 9-digit run — libphonenumber loves these.
    // But our integer-without-separator rule should bite for raw digits.
    const html = `<p>Registration code: 123456789. Call: 06 12 34 56 78.</p>`;
    const e164s = extractPhonesFromHtml(html, "https://example.com/contact").map((p) => p.normalized);
    expect(e164s).toContain("+33612345678");
    // The 9-digit registration code MUST NOT show up as a phone.
    expect(e164s).not.toContain("+33123456789");
  });

  it("rejects timestamps / Unix epochs that happen to look phone-shaped", () => {
    const html = `<p>Updated 2024-08-30 14:23:11 — call 02 99 12 34 56.</p>`;
    const e164s = extractPhonesFromHtml(html, "https://example.com/contact").map((p) => p.normalized);
    expect(e164s).toContain("+33299123456");
    // Neither half of the timestamp should produce a phone
    expect(e164s.some((e) => e?.includes("20240830"))).toBe(false);
  });
});

describe("extractEmailsFromHtml — international + edge cases", () => {
  it("accepts emails with country TLDs across continents", () => {
    const html = `
      <a href="mailto:info@beispiel.de">DE</a>
      <a href="mailto:hello@acme.co.uk">UK</a>
      <a href="mailto:ola@empresa.es">ES</a>
      <a href="mailto:tokyo@example.jp">JP</a>
      <a href="mailto:user@brand.com.sg">SG</a>
      <a href="mailto:user@brand.com.au">AU</a>
    `;
    const emails = extractEmailsFromHtml(html, "https://example.com").map((e) => e.value);
    expect(emails).toContain("info@beispiel.de");
    expect(emails).toContain("hello@acme.co.uk");
    expect(emails).toContain("ola@empresa.es");
    expect(emails).toContain("tokyo@example.jp");
    expect(emails).toContain("user@brand.com.sg");
    expect(emails).toContain("user@brand.com.au");
  });

  it("does not accept placeholder/example/test domains", () => {
    const html = `
      <a href="mailto:test@example.com">x</a>
      <a href="mailto:you@yourdomain.com">x</a>
      <a href="mailto:noreply@no-reply.com">x</a>
    `;
    const emails = extractEmailsFromHtml(html, "https://example.com").map((e) => e.value);
    expect(emails.length).toBe(0);
  });

  it("strips entity-encoded @ before extraction", () => {
    const html = `<p>Contact: hello&#64;acme.fr or write to &#104;ello&#64;acme.fr</p>`;
    const emails = extractEmailsFromHtml(html, "https://example.com").map((e) => e.value);
    expect(emails).toContain("hello@acme.fr");
  });

  it("handles obfuscated 'foo [at] bar [dot] com' format", () => {
    const html = `<p>contact [at] acme [dot] fr</p>`;
    const emails = extractEmailsFromHtml(html, "https://example.com").map((e) => e.value);
    expect(emails).toContain("contact@acme.fr");
  });
});

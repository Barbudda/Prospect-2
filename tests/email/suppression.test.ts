import { describe, it, expect } from "vitest";
import {
  normaliseEmailForSuppression,
  normalisePhoneForSuppression,
  isSuppressed,
} from "@/lib/utils/suppression";

describe("normaliseEmailForSuppression", () => {
  it("lowercases the email so casing differences match", () => {
    expect(normaliseEmailForSuppression("Hugo@Example.FR")).toBe("hugo@example.fr");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseEmailForSuppression("   hugo@example.fr   ")).toBe("hugo@example.fr");
  });

  it("returns null for empty / null / undefined", () => {
    expect(normaliseEmailForSuppression("")).toBeNull();
    expect(normaliseEmailForSuppression(null)).toBeNull();
    expect(normaliseEmailForSuppression(undefined)).toBeNull();
    expect(normaliseEmailForSuppression("   ")).toBeNull();
  });

  it("does NOT validate format — normalisation is by-design separate from validation", () => {
    // We only canonicalise. Anything else is the validator's job. This
    // matters because someone might be suppression-listed with a
    // weird-looking address from an old import, and we still want to
    // honour it on future writes.
    expect(normaliseEmailForSuppression("garbage")).toBe("garbage");
  });
});

describe("normalisePhoneForSuppression", () => {
  it("canonicalises any French write-style to E.164", () => {
    expect(normalisePhoneForSuppression("06 12 34 56 78")).toBe("+33612345678");
    expect(normalisePhoneForSuppression("06.12.34.56.78")).toBe("+33612345678");
    expect(normalisePhoneForSuppression("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(normalisePhoneForSuppression("+33 (0)6 12 34 56 78")).toBe("+33612345678");
  });

  it("returns null for invalid phones (so dedup never collides on junk)", () => {
    expect(normalisePhoneForSuppression("123")).toBeNull();
    expect(normalisePhoneForSuppression("not a phone")).toBeNull();
    expect(normalisePhoneForSuppression("")).toBeNull();
    expect(normalisePhoneForSuppression(null)).toBeNull();
  });

  it("converts a UK number to E.164 when given in international form", () => {
    // GB local form falls back to FR with our default region, so we
    // assert the international form which is unambiguous.
    expect(normalisePhoneForSuppression("+44 20 7946 0958")).toBe("+442079460958");
  });
});

describe("isSuppressed", () => {
  const set = new Set<string>([
    "email:hugo@example.fr",
    "phone:+33612345678",
  ]);

  it("matches a suppressed email regardless of casing / spaces", () => {
    expect(isSuppressed(set, { email: "Hugo@Example.FR" }).suppressed).toBe(true);
    expect(isSuppressed(set, { email: " hugo@example.fr " }).suppressed).toBe(true);
  });

  it("matches a suppressed phone regardless of write-style", () => {
    expect(isSuppressed(set, { phone: "06 12 34 56 78" }).suppressed).toBe(true);
    expect(isSuppressed(set, { phone: "+33 (0)6 12 34 56 78" }).suppressed).toBe(true);
    expect(isSuppressed(set, { phone: "06.12.34.56.78" }).suppressed).toBe(true);
  });

  it("doesn't match an unrelated contact", () => {
    expect(isSuppressed(set, { email: "other@example.fr" }).suppressed).toBe(false);
    expect(isSuppressed(set, { phone: "06 99 99 99 99" }).suppressed).toBe(false);
  });

  it("returns the matched key in the reason for auditability", () => {
    const r = isSuppressed(set, { email: "HUGO@example.fr" });
    expect(r.reason).toMatch(/email:hugo@example\.fr/);
  });

  it("allows null/undefined fields without throwing", () => {
    expect(isSuppressed(set, { email: null, phone: null }).suppressed).toBe(false);
    expect(isSuppressed(set, {}).suppressed).toBe(false);
  });

  it("treats an empty set as 'nothing suppressed'", () => {
    expect(isSuppressed(new Set(), { email: "anyone@example.fr" }).suppressed).toBe(false);
  });
});

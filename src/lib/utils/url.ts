import { URL } from "url";

export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function normalizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    // Remove trailing slash, lowercase hostname
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  // Keep only digits and leading +
  const stripped = phone.replace(/[^\d+]/g, "");
  return stripped;
}

export function toE164(phone: string, defaultCountryCode = "33"): string | null {
  const stripped = phone.replace(/[^\d]/g, "");
  if (!stripped) return null;

  // E164 range: 7–15 digits after the +
  if (phone.trim().startsWith("+")) {
    if (stripped.length >= 7 && stripped.length <= 15) return "+" + stripped;
    return null;
  }

  // +33(0)7... or 33(0)7... notation → remove the domestic (0)
  // Digits become e.g. "33" + "0" + 9 digits = 12
  if (
    stripped.startsWith(defaultCountryCode + "0") &&
    stripped.length === defaultCountryCode.length + 10
  ) {
    return `+${defaultCountryCode}${stripped.slice(defaultCountryCode.length + 1)}`;
  }

  // Domestic: 0X XX XX XX XX (10 digits starting with 0)
  if (stripped.startsWith("0") && stripped.length === 10) {
    return `+${defaultCountryCode}${stripped.slice(1)}`;
  }

  // Already includes country code without + (e.g. 33XXXXXXXXX for France = 11 digits)
  if (
    stripped.startsWith(defaultCountryCode) &&
    stripped.length === defaultCountryCode.length + 9
  ) {
    return `+${stripped}`;
  }

  return null;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function fuzzyNormalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshteinSimilarity(a: string, b: string): number {
  const an = fuzzyNormalize(a);
  const bn = fuzzyNormalize(b);
  if (an === bn) return 1;
  if (!an || !bn) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= bn.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= an.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= bn.length; i++) {
    for (let j = 1; j <= an.length; j++) {
      if (bn[i - 1] === an[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  const distance = matrix[bn.length][an.length];
  const maxLen = Math.max(an.length, bn.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

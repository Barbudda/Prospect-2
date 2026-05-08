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

  if (phone.trim().startsWith("+")) {
    return "+" + stripped;
  }

  if (stripped.startsWith("0") && stripped.length === 10) {
    // French mobile/landline: 0X XX XX XX XX → +33 X XX XX XX XX
    return `+${defaultCountryCode}${stripped.slice(1)}`;
  }

  if (stripped.length >= 10) {
    return `+${defaultCountryCode}${stripped}`;
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

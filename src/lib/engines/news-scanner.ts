// NEWS / PRESS MENTION SCANNER (#1 advanced)
//
// Searches French regional + national news domains for mentions of an
// operator's name. Uses the router's allowlisted fallback (sudouest.fr,
// ledauphine.com, ouest-france.fr, lefigaro.fr are all on the allowlist).
// Surfaces press mentions as a personalisation hook for the dossier.

import * as Router from "@/lib/providers/search-router";

export interface PressMention {
  url: string;
  title: string;
  snippet: string;
  domain: string;
  detected_year?: number;
}

const NEWS_DOMAINS = [
  "sudouest.fr",
  "ledauphine.com",
  "ouest-france.fr",
  "lefigaro.fr",
  "lemonde.fr",
  "lesechos.fr",
  "lefigaro.fr/voyages",
];

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractYear(text: string): number | undefined {
  const m = text.match(/\b(20\d{2})\b/);
  if (!m) return undefined;
  const y = parseInt(m[1], 10);
  if (y < 2010 || y > new Date().getFullYear() + 1) return undefined;
  return y;
}

export async function scanPressMentions(
  operatorName: string,
  city: string
): Promise<PressMention[]> {
  if (!operatorName || operatorName.length < 3) return [];

  const mentions: PressMention[] = [];
  const seen = new Set<string>();

  // One query per news domain — allowlisted, refused queries throw and we skip
  for (const domain of NEWS_DOMAINS) {
    try {
      const q = `site:${domain} "${operatorName}" "${city}"`;
      const results = await Router.fallbackWebSearch({ q, num: 3 });
      for (const r of results) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        mentions.push({
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          domain: extractDomain(r.url),
          detected_year: extractYear(`${r.title} ${r.snippet}`),
        });
      }
    } catch {
      // refused or failed query — non-fatal
    }
  }

  return mentions;
}

import type { NormalizedLead } from "@/lib/types";
import { normalizeEmail, normalizePhone, extractDomain, levenshteinSimilarity, fuzzyNormalize } from "@/lib/utils/url";

function getDedupeKey(lead: NormalizedLead): string[] {
  const keys: string[] = [];

  if (lead.domain) keys.push(`domain:${lead.domain.toLowerCase()}`);
  if (lead.email) keys.push(`email:${normalizeEmail(lead.email)}`);
  if (lead.phone) {
    const n = normalizePhone(lead.phone);
    if (n) keys.push(`phone:${n}`);
  }
  if (lead.google_maps_url) {
    const placeIdMatch = lead.google_maps_url.match(/place_id:([^&/]+)/);
    if (placeIdMatch) keys.push(`place_id:${placeIdMatch[1]}`);
  }

  return keys;
}

export function deduplicateLeads(leads: NormalizedLead[]): NormalizedLead[] {
  const merged: NormalizedLead[] = [];
  const keyIndex = new Map<string, number>(); // key → index in merged

  for (const lead of leads) {
    const keys = getDedupeKey(lead);
    let existingIdx: number | undefined;

    // Check exact key matches
    for (const key of keys) {
      if (keyIndex.has(key)) {
        existingIdx = keyIndex.get(key);
        break;
      }
    }

    // If not found by exact key, try fuzzy company name + city
    if (existingIdx === undefined && lead.primary_name && lead.city) {
      const normalizedName = fuzzyNormalize(lead.primary_name);
      const normalizedCity = fuzzyNormalize(lead.city);

      for (let i = 0; i < merged.length; i++) {
        const m = merged[i];
        if (m.city && fuzzyNormalize(m.city) === normalizedCity && m.primary_name) {
          const sim = levenshteinSimilarity(m.primary_name, lead.primary_name);
          if (sim > 0.9) {
            existingIdx = i;
            break;
          }
        }
      }
    }

    if (existingIdx !== undefined) {
      // Merge into existing
      const existing = merged[existingIdx];
      merged[existingIdx] = mergeLead(existing, lead);
      // Re-index new keys
      for (const key of keys) {
        if (!keyIndex.has(key)) keyIndex.set(key, existingIdx);
      }
    } else {
      const newIdx = merged.length;
      merged.push(lead);
      for (const key of keys) {
        keyIndex.set(key, newIdx);
      }
    }
  }

  return merged;
}

function pickHigherConfidence<T extends { confidence?: string }>(
  a: T | undefined | null,
  b: T | undefined | null
): T | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a ?? undefined;
  const order = ["high", "medium", "low"];
  const ai = order.indexOf(a.confidence ?? "low");
  const bi = order.indexOf(b.confidence ?? "low");
  return ai <= bi ? a : b;
}

function mergeLead(base: NormalizedLead, incoming: NormalizedLead): NormalizedLead {
  const result: NormalizedLead = { ...base };

  // Prefer non-null, higher-confidence values
  result.email = base.email ?? incoming.email;
  result.phone = base.phone ?? incoming.phone;
  result.website_url = base.website_url ?? incoming.website_url;
  result.domain = base.domain ?? incoming.domain;
  result.instagram_url = base.instagram_url ?? incoming.instagram_url;
  result.linkedin_url = base.linkedin_url ?? incoming.linkedin_url;
  result.facebook_url = base.facebook_url ?? incoming.facebook_url;
  result.contact_form_url = base.contact_form_url ?? incoming.contact_form_url;
  result.address = base.address ?? incoming.address;
  result.google_maps_url = base.google_maps_url ?? incoming.google_maps_url;
  result.whatsapp_url = base.whatsapp_url ?? incoming.whatsapp_url;
  result.person_name = base.person_name ?? incoming.person_name;

  // Merge sources (union)
  const allSources = [...(base.sources ?? []), ...(incoming.sources ?? [])];
  const seen = new Set<string>();
  result.sources = allSources.filter((s) => {
    if (seen.has(s.source_url)) return false;
    seen.add(s.source_url);
    return true;
  });

  // Merge signals
  result.signals = [...(base.signals ?? []), ...(incoming.signals ?? [])];

  // Merge keywords
  const baseKeywords = base.quality_summary ?? "";
  const incomingKeywords = incoming.quality_summary ?? "";
  if (!baseKeywords.includes(incomingKeywords) && incomingKeywords) {
    result.quality_summary = baseKeywords
      ? `${baseKeywords} | ${incomingKeywords}`
      : incomingKeywords;
  }

  // Increase confidence when multiple sources agree
  if ((result.sources?.length ?? 0) >= 2) {
    result.confidence = result.confidence === "low" ? "medium" : "high";
  }

  return result;
}

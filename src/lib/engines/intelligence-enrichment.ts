import type { NormalizedLead } from "@/lib/types";
import { validatePublicUrl } from "@/lib/utils/ssrf";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImageMatch {
  url: string;
  title: string;
  thumbnail?: string;
}

export interface DuplicateSource {
  url: string;
  platform: string;
}

export interface ReconstructionResult {
  reconstruction_confidence: number;
  exclusivity_score: number;
  reconstructed: boolean;
  multi_platform: boolean;
  platform_count: number;
  platforms_found: string[];
  image_matches: ImageMatch[];
  duplicate_sources: DuplicateSource[];
  geo_signals: Record<string, unknown>;
}

export interface LeadWithOgImage {
  lead: NormalizedLead;
  ogImage?: string;
}

// ─── OTA platform registry ────────────────────────────────────────────────────

const OTA_PLATFORM_MAP: Record<string, string> = {
  "airbnb.com": "Airbnb",
  "airbnb.fr": "Airbnb",
  "booking.com": "Booking.com",
  "abritel.fr": "Abritel",
  "vrbo.com": "VRBO",
  "homeaway.com": "HomeAway",
  "gites.fr": "Gîtes de France",
  "clevacances.com": "Clévacances",
  "tripadvisor.com": "TripAdvisor",
  "tripadvisor.fr": "TripAdvisor",
  "hometogo.fr": "HomeToGo",
  "wimdu.fr": "Wimdu",
  "paruvendu.fr": "ParuVendu",
  "leboncoin.fr": "Leboncoin",
};

// ─── SerpAPI helpers ──────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function serpSearch(
  query: string,
  gl: string
): Promise<Array<{ url: string; title: string }>> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    api_key: apiKey,
    engine: "google",
    q: query,
    gl,
    hl: gl === "fr" ? "fr" : "en",
    num: "10",
    safe: "active",
  });

  try {
    const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { organic_results?: Array<{ link?: string; title?: string }> };
    return (data.organic_results ?? []).map((r) => ({
      url: r.link ?? "",
      title: r.title ?? "",
    }));
  } catch {
    return [];
  }
}

async function serpReverseImage(imageUrl: string): Promise<ImageMatch[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return [];

  const validation = validatePublicUrl(imageUrl);
  if (!validation.ok) return [];

  const params = new URLSearchParams({
    api_key: apiKey,
    engine: "google_reverse_image",
    image_url: imageUrl,
  });

  try {
    const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      image_results?: Array<{ link?: string; title?: string; thumbnail?: string }>;
    };
    return (data.image_results ?? [])
      .filter((r) => r.link && r.title)
      .map((r) => ({ url: r.link!, title: r.title!, thumbnail: r.thumbnail }))
      .slice(0, 5);
  } catch {
    return [];
  }
}

function toGl(country: string): string {
  const map: Record<string, string> = {
    france: "fr", "united kingdom": "gb", uk: "gb",
    spain: "es", italy: "it", germany: "de",
    portugal: "pt", usa: "us", "united states": "us",
  };
  return map[country.toLowerCase().trim()] ?? "fr";
}

// ─── Single-lead reconstruction ───────────────────────────────────────────────

async function reconstructSingleLead(
  lead: NormalizedLead,
  ogImage?: string
): Promise<ReconstructionResult> {
  const gl = toGl(lead.country);
  const name = (lead.company_name ?? lead.primary_name)
    .replace(/['"]/g, "")
    .trim()
    .slice(0, 60);

  const query = `"${name}" ${lead.city}`;
  const results = await serpSearch(query, gl);

  // Identify OTA platforms in search results
  const platformsMap = new Map<string, string>();
  const duplicateSources: DuplicateSource[] = [];

  for (const r of results) {
    if (!r.url) continue;
    try {
      const hostname = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
      const platform = OTA_PLATFORM_MAP[hostname];
      if (platform && !platformsMap.has(hostname)) {
        platformsMap.set(hostname, platform);
        duplicateSources.push({ url: r.url, platform });
      }
    } catch {
      // skip invalid URLs
    }
  }

  const platformsFound = Array.from(platformsMap.values());
  const platform_count = platformsFound.length;

  // Reverse image search (optional — only if og:image captured)
  let imageMatches: ImageMatch[] = [];
  if (ogImage) {
    await sleep(600);
    imageMatches = await serpReverseImage(ogImage);
  }

  // Exclusivity score: 100 = only findable via their own site (hard for competitors)
  // Each OTA platform found = -20 (they're easier to find)
  let exclusivity = 100 - platform_count * 20;
  // Bonus if they have a direct booking site with no OTA presence
  if (platform_count === 0 && lead.website_url) exclusivity += 5;
  exclusivity = Math.max(0, Math.min(100, exclusivity));

  // Reconstruction confidence: how sure we are this is a real, verified lead
  let confidence = 20;
  if (results.length >= 5) confidence += 20;
  else if (results.length >= 2) confidence += 10;
  if (platform_count >= 1) confidence += 25;
  if (platform_count >= 3) confidence += 15;
  if (imageMatches.length >= 1) confidence += 25;
  if (lead.email) confidence += 10;
  if (lead.phone) confidence += 5;
  confidence = Math.min(100, confidence);

  return {
    reconstruction_confidence: confidence,
    exclusivity_score: exclusivity,
    reconstructed: platform_count >= 1 || imageMatches.length >= 1,
    multi_platform: platform_count >= 2,
    platform_count,
    platforms_found: platformsFound,
    image_matches: imageMatches,
    duplicate_sources: duplicateSources,
    geo_signals: {
      city: lead.city,
      country: lead.country,
      search_results_count: results.length,
    },
  };
}

// ─── Batch enrichment ─────────────────────────────────────────────────────────

export async function runReconstructionEnrichment(
  leads: LeadWithOgImage[],
  maxLeads = 15
): Promise<Map<string, ReconstructionResult>> {
  if (!process.env.SERPAPI_API_KEY) return new Map();

  const eligible = leads
    .filter((l) => l.lead.score >= 40 && l.lead.primary_name)
    .slice(0, maxLeads);

  const results = new Map<string, ReconstructionResult>();

  for (const { lead, ogImage } of eligible) {
    try {
      const result = await reconstructSingleLead(lead, ogImage);
      const key = lead.website_url ?? lead.primary_name;
      results.set(key, result);
      await sleep(1_000);
    } catch {
      // per-lead errors never crash the batch
    }
  }

  return results;
}

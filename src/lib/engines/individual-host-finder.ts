// Engine 0.5: Individual Airbnb Host Discovery
// Finds small operators (1-2 properties) via OTA listing search.
// These leads are NOT findable via standard web/business search.

import type { NormalizedLead } from "@/lib/types";
import { scoreLead } from "./scorer";
import { generateOutreachAngle } from "./outreach";

// ─── Snippet parser ───────────────────────────────────────────────────────────

interface ParsedListing {
  hostName: string | null;
  isSuperhost: boolean;
  reviewCount: number | null;
  rating: number | null;
  propertyType: string | null;
}

// Fix double UTF-8 encoding that appears when bytes are misread as Latin-1
function fixEncoding(text: string): string {
  try {
    const bytes = new Uint8Array(text.split("").map((c) => c.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded;
  } catch {
    return text;
  }
}

function parseAirbnbSnippet(snippet: string): ParsedListing {
  // Snippets look like: "Marie · Superhôte · 4.97 (87 avis) · Appartement entier à Paris"
  const parts = snippet.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
  const candidate = parts[0] ?? null;
  // Only treat as a host name if it's short enough and looks like a personal name
  // (no full sentences, no periods mid-text, length 2-40, not all caps words)
  const looksLikeName =
    candidate !== null &&
    candidate.length >= 2 &&
    candidate.length <= 40 &&
    !/[.,;:!?]/.test(candidate) &&
    !/\b(location|appartement|villa|maison|studio|chalet|room|stay|prime|perfect|spacious|luxe|cozy)\b/i.test(candidate);
  const hostName = looksLikeName ? candidate : null;
  const isSuperhost = /superhôte|superhost/i.test(snippet);
  const reviewMatch = snippet.match(/\((\d+)\s*(?:avis|reviews?)\)/i);
  const reviewCount = reviewMatch ? parseInt(reviewMatch[1], 10) : null;
  const ratingMatch = snippet.match(/\b([45]\.\d{1,2})\b/);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
  const typeMatch = snippet.match(
    /(appartement entier|villa entière?|maison entière?|chambre privée?|chalet entier|studio entier|logement entier|entire home|entire villa|entire apartment|private room)/i
  );
  const propertyType = typeMatch?.[1] ?? null;
  return { hostName, isSuperhost, reviewCount, rating, propertyType };
}

function extractListingTitle(title: string): string {
  // "Appartement de charme au cœur de Biarritz - Biarritz - Airbnb"
  const cleaned = title.replace(/[\s\-–|]+(?:airbnb|abritel|vrbo|booking\.com)\s*$/i, "").trim();
  // Extract the short property name before the first em-dash or long separator
  const shortMatch = cleaned.match(/^([^–—]{4,60})\s*[–—]/);
  return shortMatch ? shortMatch[1].trim() : cleaned;
}

// ─── SerpAPI search ───────────────────────────────────────────────────────────

async function serpSearch(
  query: string,
  gl: string,
  hl: string
): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    api_key: apiKey,
    engine: "google",
    q: query,
    gl,
    hl,
    num: "10",
    safe: "active",
  });

  try {
    const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      organic_results?: Array<{ link?: string; title?: string; snippet?: string }>;
    };
    return (data.organic_results ?? []).map((r) => ({
      url: r.link ?? "",
      title: fixEncoding(r.title ?? ""),
      snippet: fixEncoding(r.snippet ?? ""),
    }));
  } catch {
    return [];
  }
}

// Instagram profile search for a property name
async function findInstagram(
  propertyName: string,
  city: string,
  gl: string
): Promise<string | null> {
  const results = await serpSearch(
    `site:instagram.com "${propertyName}" OR "${propertyName} ${city}"`,
    gl,
    gl === "fr" ? "fr" : "en"
  );
  for (const r of results) {
    if (r.url.includes("instagram.com/") && !r.url.includes("/p/")) {
      return r.url;
    }
  }
  return null;
}

// ─── Main discovery function ──────────────────────────────────────────────────

const AIRBNB_LISTING_PATTERN = /airbnb\.(com|fr)\/rooms\/\d+/i;
const ABRITEL_LISTING_PATTERN = /abritel\.fr\/location-vacances\//i;

function toGl(country: string): string {
  const map: Record<string, string> = {
    france: "fr", "united kingdom": "gb", uk: "gb",
    spain: "es", italy: "it", germany: "de",
    portugal: "pt", usa: "us", "united states": "us",
  };
  return map[country.toLowerCase().trim()] ?? "fr";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface IndividualHostFilters {
  superhostOnly?: boolean;
  minReviews?: number;
  platform?: "all" | "airbnb" | "abritel";
}

export async function runIndividualHostFinder(
  city: string,
  country: string,
  maxLeads = 30,
  filters: IndividualHostFilters = {}
): Promise<NormalizedLead[]> {
  const { superhostOnly = false, minReviews = 0, platform = "all" } = filters;
  const gl = toGl(country); // used by the Instagram lookup helper below

  // ── Direct-scrape Airbnb + Abritel via the router (no SerpAPI site: queries)
  const directListings: Array<{ url: string; title: string; snippet: string }> = [];
  const { searchListings } = await import("@/lib/providers/search-router");

  if (platform !== "abritel") {
    try {
      const airbnbHits = await searchListings({
        platform: "airbnb",
        city,
        filters: { superhost: superhostOnly },
        maxListingsPerPlatform: Math.max(maxLeads * 2, 30),
      });
      for (const l of airbnbHits) {
        directListings.push({
          url: l.url,
          title: l.title,
          snippet: [l.hostDisplayName ?? "", l.title, city].filter(Boolean).join(" · "),
        });
      }
    } catch (err) {
      console.error("[host-finder] airbnb scrape failed:", err instanceof Error ? err.message : err);
    }
  }

  if (platform !== "airbnb") {
    try {
      const abritelHits = await searchListings({
        platform: "abritel",
        city,
        filters: { hostType: "particulier" },
        maxListingsPerPlatform: Math.max(maxLeads, 20),
      });
      for (const l of abritelHits) {
        directListings.push({
          url: l.url,
          title: l.title,
          snippet: [l.hostDisplayName ?? "particulier", l.title, city].filter(Boolean).join(" · "),
        });
      }
    } catch (err) {
      console.error("[host-finder] abritel scrape failed:", err instanceof Error ? err.message : err);
    }
  }

  const seen = new Set<string>();
  const rawResults: Array<{ url: string; title: string; snippet: string }> = [];
  for (const r of directListings) {
    if (r.url && !seen.has(r.url) && (AIRBNB_LISTING_PATTERN.test(r.url) || ABRITEL_LISTING_PATTERN.test(r.url))) {
      seen.add(r.url);
      rawResults.push(r);
    }
  }

  // ── Parse each listing into a lead ───────────────────────────────────────
  const leads: NormalizedLead[] = [];

  for (const result of rawResults.slice(0, maxLeads)) {
    const { hostName, isSuperhost, reviewCount, rating } = parseAirbnbSnippet(result.snippet);
    const listingTitle = extractListingTitle(result.title);

    // Skip if no meaningful host signal
    if (!hostName && !listingTitle) continue;

    // Apply targeting filters
    if (superhostOnly && !isSuperhost) continue;
    if (minReviews > 0 && (reviewCount ?? 0) < minReviews) continue;

    const displayName = [hostName, listingTitle].filter(Boolean).join(" — ");

    // Quality summary with all signals
    const summaryParts = [
      `Individual Airbnb host found via listing search for "${city}".`,
      listingTitle ? `Property: "${listingTitle}".` : null,
      hostName ? `Host: ${hostName}.` : null,
      isSuperhost ? "Superhost status confirmed." : null,
      reviewCount ? `${reviewCount} guest reviews.` : null,
      rating ? `Average rating: ${rating}/5.` : null,
    ].filter(Boolean);

    const partial: Partial<NormalizedLead> = {
      primary_name: displayName,
      company_name: listingTitle || undefined,
      person_name: hostName || undefined,
      lead_type: "Individual Airbnb Host",
      city,
      country,
      website_url: undefined, // no external website (it's an OTA listing)
      source_url: result.url,
      source_type: "individual_host",
      contact_form_url: result.url, // Airbnb listing = contact via platform
      quality_summary: summaryParts.join(" "),
      confidence: isSuperhost || (reviewCount ?? 0) > 10 ? "high" : "medium",
      status: "new",
      outreach_status: "not_contacted",
      superhost: isSuperhost,
      review_count: reviewCount ?? undefined,
      listing_title: listingTitle || undefined,
      sources: [
        {
          provider: "airbnb_listing",
          source_url: result.url,
          source_type: "individual_host",
          title: listingTitle || result.title,
          snippet: result.snippet,
          evidence_text: summaryParts.join(" "),
          confidence: "high",
        },
      ],
    };

    const { score, label } = scoreLead(partial);
    const lead: NormalizedLead = {
      ...partial,
      score,
      score_label: label,
      suggested_angle: generateOutreachAngle("Individual Airbnb Host"),
      source_url: result.url,
    } as NormalizedLead;

    leads.push(lead);
    await sleep(50);
  }

  // ── Secondary: find Instagram for top superhosts ─────────────────────────
  const topHosts = leads
    .filter((l) => l.superhost || (l.review_count ?? 0) >= 15)
    .slice(0, 5);

  for (const lead of topHosts) {
    if (!lead.listing_title) continue;
    try {
      const igUrl = await findInstagram(lead.listing_title, city, gl);
      if (igUrl) {
        const idx = leads.findIndex((l) => l.source_url === lead.source_url);
        if (idx !== -1) {
          leads[idx].instagram_url = igUrl;
          // Re-score with Instagram signal
          const { score, label } = scoreLead(leads[idx]);
          leads[idx].score = score;
          leads[idx].score_label = label;
        }
      }
      await sleep(1_000);
    } catch {
      // best-effort
    }
  }

  return leads;
}

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

function parseAirbnbSnippet(snippet: string): ParsedListing {
  // Snippets look like: "Marie · Superhôte · 4.97 (87 avis) · Appartement entier à Paris"
  const parts = snippet.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
  const hostName = parts[0] ?? null;
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
  return title.replace(/[\s\-–|]+(?:airbnb|abritel|vrbo|booking\.com)\s*$/i, "").trim();
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
      title: r.title ?? "",
      snippet: r.snippet ?? "",
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

export async function runIndividualHostFinder(
  city: string,
  country: string,
  maxLeads = 30
): Promise<NormalizedLead[]> {
  if (!process.env.SERPAPI_API_KEY) return [];

  const gl = toGl(country);
  const hl = gl === "fr" ? "fr" : "en";
  const isFrance = country.toLowerCase().includes("franc");

  // ── Search queries targeting individual listings ──────────────────────────
  const queries: string[] = [
    `site:airbnb.com/rooms "${city}"`,
    ...(isFrance ? [`site:airbnb.fr/rooms "${city}"`] : []),
    `site:abritel.fr/location-vacances "${city}" particulier`,
    `site:airbnb.com/rooms ${city} superhost`,
  ];

  const seen = new Set<string>();
  const rawResults: Array<{ url: string; title: string; snippet: string }> = [];

  for (const q of queries) {
    const results = await serpSearch(q, gl, hl);
    for (const r of results) {
      if (
        r.url &&
        !seen.has(r.url) &&
        (AIRBNB_LISTING_PATTERN.test(r.url) || ABRITEL_LISTING_PATTERN.test(r.url))
      ) {
        seen.add(r.url);
        rawResults.push(r);
      }
    }
    await sleep(800);
  }

  // ── Parse each listing into a lead ───────────────────────────────────────
  const leads: NormalizedLead[] = [];

  for (const result of rawResults.slice(0, maxLeads)) {
    const { hostName, isSuperhost, reviewCount, rating } = parseAirbnbSnippet(result.snippet);
    const listingTitle = extractListingTitle(result.title);

    // Skip if no meaningful host signal
    if (!hostName && !listingTitle) continue;

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

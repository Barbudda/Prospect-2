// Listing image scraper — extracts photos from Airbnb / Abritel / Booking URLs
// Used as the first step of the visual prospecting pipeline.
// Only fetches public, SSRF-validated URLs. No auth, no scraping behind login.

import { validatePublicUrl } from "@/lib/utils/ssrf";

export interface ScrapedListing {
  images: string[];
  title?: string;
  description?: string;
  raw_text?: string;
}

// Airbnb photo CDN pattern
const MUSCACHE_RE = /https:\/\/a\d*\.muscache\.com\/im\/(?:pictures|photos)\/[^\s"'<>\\]+\.(?:jpg|jpeg|webp)/gi;

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#x([0-9a-f]+);/gi, (_, h) =>
    String.fromCodePoint(parseInt(h, 16))
  );
}

function extractMeta(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']|` +
    `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
    "i"
  );
  const m = html.match(re);
  return m ? decodeEntities((m[1] ?? m[2] ?? "").trim()) : undefined;
}

export async function scrapeListingImages(listingUrl: string): Promise<ScrapedListing> {
  const validation = validatePublicUrl(listingUrl);
  if (!validation.ok) return { images: [] };

  let html = "";
  try {
    const res = await fetch(listingUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(18_000),
    });
    if (!res.ok) return { images: [] };
    html = await res.text();
  } catch {
    return { images: [] };
  }

  const seen = new Set<string>();
  const images: string[] = [];

  function addImage(raw: string) {
    const url = raw.split("?")[0].replace(/\\u002F/g, "/").replace(/\\/g, "");
    if (!url || seen.has(url)) return;
    if (validatePublicUrl(url).ok) {
      seen.add(url);
      images.push(url);
    }
  }

  // 1. og:image — always the main listing photo
  const ogImage = extractMeta(html, "og:image");
  if (ogImage) addImage(ogImage);

  // 2. Airbnb CDN images from page source
  const cdnMatches = html.match(MUSCACHE_RE) ?? [];
  for (const m of cdnMatches.slice(0, 15)) addImage(m);

  // 3. JSON-LD thumbnail / image arrays
  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, jsonText] of jsonLdMatches) {
    try {
      const obj = JSON.parse(jsonText) as Record<string, unknown>;
      const candidates: unknown[] = [
        obj.image,
        obj.primaryImageOfPage,
        obj.thumbnail,
      ].flat();
      for (const c of candidates) {
        if (typeof c === "string") addImage(c);
        if (typeof c === "object" && c && "url" in c) addImage((c as { url: string }).url);
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }

  const title = extractMeta(html, "og:title")
    ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();

  const description = extractMeta(html, "og:description");

  // Visible text snippet for listing_text context
  const raw_text = [title, description].filter(Boolean).join(". ").slice(0, 500);

  return {
    images: images.slice(0, 6),
    title,
    description,
    raw_text,
  };
}

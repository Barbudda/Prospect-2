// Reverse Image Search — powered by Google Vision API (Web Detection feature)
// Finds duplicate listing images on external sites and direct booking pages.
// Uses the existing GOOGLE_VISION_API_KEY — no additional account needed.
// Raw results only — Mammouth clusters and deduplicates the output.

export interface BingVisualResult {
  url: string;
  name: string;
  thumbnail?: string;
  website_name?: string;
  date_published?: string;
}

export interface BingVisualSearchResponse {
  results: BingVisualResult[];
  related_searches: string[];
}

const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

export function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_VISION_API_KEY);
}

export async function reverseImageSearch(
  imageUrl: string
): Promise<BingVisualSearchResponse> {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) throw new Error("GOOGLE_VISION_API_KEY not configured");

  const body = {
    requests: [
      {
        image: { source: { imageUri: imageUrl } },
        features: [{ type: "WEB_DETECTION", maxResults: 20 }],
      },
    ],
  };

  const res = await fetch(`${VISION_ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Google Vision Web Detection HTTP ${res.status}`);
  }

  const data = await res.json() as {
    responses?: Array<{
      webDetection?: {
        pagesWithMatchingImages?: Array<{ url?: string; pageTitle?: string }>;
        fullMatchingImages?: Array<{ url?: string }>;
        partialMatchingImages?: Array<{ url?: string }>;
        webEntities?: Array<{ description?: string }>;
        bestGuessLabels?: Array<{ label?: string }>;
      };
      error?: { message?: string };
    }>;
  };

  const detection = data.responses?.[0]?.webDetection;
  if (!detection) return { results: [], related_searches: [] };

  // Collect pages that contain this image (most useful for finding OTA duplicates)
  const results: BingVisualResult[] = [];
  const seenUrls = new Set<string>();

  for (const page of detection.pagesWithMatchingImages ?? []) {
    if (page.url && !seenUrls.has(page.url)) {
      seenUrls.add(page.url);
      results.push({
        url: page.url,
        name: page.pageTitle ?? "",
        website_name: (() => {
          try { return new URL(page.url).hostname.replace(/^www\./, ""); } catch { return undefined; }
        })(),
      });
    }
  }

  // Also collect direct image URL matches (these point to exact duplicates on other platforms)
  for (const img of [...(detection.fullMatchingImages ?? []), ...(detection.partialMatchingImages ?? [])]) {
    if (img.url && !seenUrls.has(img.url)) {
      seenUrls.add(img.url);
      results.push({ url: img.url, name: "Image match" });
    }
  }

  const related_searches = (detection.webEntities ?? [])
    .map((e) => e.description ?? "")
    .filter(Boolean)
    .slice(0, 10);

  return {
    results: results.slice(0, 20),
    related_searches,
  };
}

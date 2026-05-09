// Bing Visual Search API — reverse image search for listing images
// Finds duplicate images on external listing sites and direct booking pages.
// Raw results only — Mammouth clusters and deduplicates the output.
//
// Config env var: BING_VISUAL_SEARCH_API_KEY

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

const BING_ENDPOINT = "https://api.bing.microsoft.com/v7.0/images/visualsearch";

export function isConfigured(): boolean {
  return Boolean(process.env.BING_VISUAL_SEARCH_API_KEY);
}

export async function reverseImageSearch(
  imageUrl: string
): Promise<BingVisualSearchResponse> {
  const key = process.env.BING_VISUAL_SEARCH_API_KEY;
  if (!key) throw new Error("BING_VISUAL_SEARCH_API_KEY not configured");

  // Bing Visual Search accepts the image URL via a knowledgeRequest JSON blob
  const knowledgeRequest = JSON.stringify({
    imageInfo: { url: imageUrl },
  });

  const form = new FormData();
  form.append("knowledgeRequest", knowledgeRequest);

  const res = await fetch(BING_ENDPOINT, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
    },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`Bing Visual Search HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = await res.json() as {
    tags?: Array<{
      actions?: Array<{
        actionType?: string;
        data?: {
          value?: Array<{
            contentUrl?: string;
            name?: string;
            thumbnailUrl?: string;
            hostPageUrl?: string;
            datePublished?: string;
            hostPageDisplayUrl?: string;
          }>;
        };
        relatedSearches?: Array<{ text?: string }>;
      }>;
    }>;
  };

  const results: BingVisualResult[] = [];
  const relatedSearches: string[] = [];

  for (const tag of data.tags ?? []) {
    for (const action of tag.actions ?? []) {
      if (action.actionType === "PagesIncluding") {
        for (const item of action.data?.value ?? []) {
          if (item.hostPageUrl) {
            results.push({
              url: item.hostPageUrl,
              name: item.name ?? "",
              thumbnail: item.thumbnailUrl,
              website_name: item.hostPageDisplayUrl,
              date_published: item.datePublished,
            });
          }
        }
      }
      if (action.actionType === "RelatedSearches") {
        for (const rs of action.relatedSearches ?? []) {
          if (rs.text) relatedSearches.push(rs.text);
        }
      }
    }
  }

  return {
    results: results.slice(0, 20),
    related_searches: relatedSearches.slice(0, 10),
  };
}

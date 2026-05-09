// Mammouth API — central intelligence layer
// All matching, scoring, reasoning, and ranking in the geo-reconstruction pipeline
// go through this client. External APIs only provide raw data.
//
// Config env vars:
//   MAMMOUTH_API_KEY      — required
//   MAMMOUTH_BASE_URL     — optional, defaults to https://app.mammouth.ai/api/v1
//   MAMMOUTH_CHAT_MODEL   — optional, defaults to gpt-4o
//   MAMMOUTH_EMBED_MODEL  — optional, defaults to text-embedding-3-small

const BASE_URL = () =>
  (process.env.MAMMOUTH_BASE_URL ?? "https://app.mammouth.ai/api/v1").replace(/\/$/, "");

const CHAT_MODEL = () => process.env.MAMMOUTH_CHAT_MODEL ?? "gpt-4o";
const EMBED_MODEL = () => process.env.MAMMOUTH_EMBED_MODEL ?? "text-embedding-3-small";

export function isConfigured(): boolean {
  return Boolean(process.env.MAMMOUTH_API_KEY);
}

// ─── Internal fetch helper ────────────────────────────────────────────────────

async function mammouthPost<T>(endpoint: string, body: unknown): Promise<T> {
  const key = process.env.MAMMOUTH_API_KEY;
  if (!key) throw new Error("MAMMOUTH_API_KEY not configured");

  const res = await fetch(`${BASE_URL()}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mammouth HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

// ─── Chat completion shape ────────────────────────────────────────────────────

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface EmbeddingResponse {
  data?: Array<{ embedding: number[] }>;
}

// ─── Text embedding ───────────────────────────────────────────────────────────

export async function generateTextEmbedding(text: string): Promise<number[]> {
  const data = await mammouthPost<EmbeddingResponse>("/embeddings", {
    model: EMBED_MODEL(),
    input: text.slice(0, 8000),
  });
  return data.data?.[0]?.embedding ?? [];
}

// ─── Cosine similarity (pure math — no API call) ──────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function computeTextSimilarity(a: string, b: string): Promise<number> {
  const [embA, embB] = await Promise.all([
    generateTextEmbedding(a),
    generateTextEmbedding(b),
  ]);
  return cosineSimilarity(embA, embB);
}

// ─── Image analysis via vision-capable model ──────────────────────────────────

type MessageContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

export async function analyzeImages(
  imageUrls: string[],
  prompt: string
): Promise<string> {
  const content: MessageContent[] = [
    { type: "text", text: prompt },
    ...imageUrls.slice(0, 4).map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "high" as const },
    })),
  ];

  const data = await mammouthPost<ChatResponse>("/chat/completions", {
    model: CHAT_MODEL(),
    messages: [{ role: "user", content }],
    max_tokens: 1500,
  });

  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Image embedding via semantic description ─────────────────────────────────
// Mammouth describes the image, then embeds the description — enables cosine
// similarity between listing images and street-view captures.

export async function generateImageEmbedding(imageUrl: string): Promise<number[]> {
  const description = await analyzeImages(
    [imageUrl],
    "Describe this property image in precise detail: architecture style, facade materials, window patterns, balconies, exterior features, vegetation, roofline, environment type, and any distinctive visual landmarks visible."
  );
  if (!description) return [];
  return generateTextEmbedding(description);
}

// ─── Structured reasoning with JSON output ────────────────────────────────────

export async function reason<T>(
  systemPrompt: string,
  userPrompt: string
): Promise<T | null> {
  const data = await mammouthPost<ChatResponse>("/chat/completions", {
    model: CHAT_MODEL(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 2000,
  });

  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

// ─── Candidate ranking ────────────────────────────────────────────────────────

export async function rankCandidates<T extends Record<string, unknown>>(
  candidates: T[],
  criteria: string
): Promise<T[]> {
  if (!candidates.length) return [];

  const result = await reason<{ ranked_indices: number[] }>(
    "You are a ranking engine. Analyze candidates and return ranked indices as JSON.",
    `Rank these ${candidates.length} candidates (0-indexed) by: ${criteria}.
Candidates:
${candidates.map((c, i) => `[${i}] ${JSON.stringify(c)}`).join("\n")}

Respond with JSON: { "ranked_indices": [ordered list of indices, best first] }`
  );

  if (!result?.ranked_indices?.length) return candidates;

  const ranked: T[] = [];
  const used = new Set<number>();
  for (const idx of result.ranked_indices) {
    if (idx >= 0 && idx < candidates.length && !used.has(idx)) {
      ranked.push(candidates[idx]);
      used.add(idx);
    }
  }
  // Append any candidates not returned by Mammouth
  for (let i = 0; i < candidates.length; i++) {
    if (!used.has(i)) ranked.push(candidates[i]);
  }

  return ranked;
}

// ─── Visual similarity between listing and street-view images ─────────────────
// Uses the vision model directly — images are sent as image_url blocks so the
// model actually sees them. The former text-only approach (passing URLs as
// strings to reason()) could not access images and would hallucinate scores.

export async function computeVisualSimilarity(
  listingImageUrls: string[],
  streetViewImageUrls: string[]
): Promise<number> {
  const listing = listingImageUrls.slice(0, 2);
  const streetView = streetViewImageUrls.slice(0, 2);
  if (!listing.length || !streetView.length) return 0;

  const content: MessageContent[] = [
    {
      type: "text",
      text: `You will see ${listing.length} listing image(s) followed by ${streetView.length} street-view image(s).
Determine whether they show the same physical property or building.
Focus strictly on: building facade, architectural style, window patterns, balconies, roofline, vegetation, gates, surrounding environment.
Rate visual similarity 0-100 (0 = definitely different property, 100 = definitely the same).
Respond ONLY with valid JSON: {"similarity_score": number, "reasoning": string}`,
    },
    ...listing.map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "high" as const },
    })),
    { type: "text" as const, text: "--- Street view images ---" },
    ...streetView.map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "low" as const },
    })),
  ];

  const data = await mammouthPost<ChatResponse>("/chat/completions", {
    model: CHAT_MODEL(),
    messages: [{ role: "user", content }],
    response_format: { type: "json_object" },
    max_tokens: 300,
  });

  const text = data.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(text) as { similarity_score?: number };
    return Math.max(0, Math.min(100, parsed.similarity_score ?? 0));
  } catch {
    return 0;
  }
}

// ─── Global confidence scoring ────────────────────────────────────────────────

export interface GlobalScores {
  geo_confidence: number;
  image_match_confidence: number;
  entity_confidence: number;
}

export async function computeGlobalScores(context: {
  geo_hypotheses_count: number;
  best_geo_confidence: number;
  street_view_similarity: number;
  has_parcel: boolean;
  has_operator: boolean;
  has_contact: boolean;
  direct_booking: boolean;
  image_matches_count: number;
}): Promise<GlobalScores> {
  const result = await reason<GlobalScores>(
    "You are a lead-quality scoring engine. Compute confidence scores from 0 to 100.",
    `Given this pipeline context, compute three scores:
- geo_confidence: how certain is the geographic location detection
- image_match_confidence: how reliable is the property visual identification
- entity_confidence: how reliably was the operator identified and verified

Context: ${JSON.stringify(context)}

Respond with JSON: { "geo_confidence": number, "image_match_confidence": number, "entity_confidence": number }`
  );

  return {
    geo_confidence: Math.max(0, Math.min(100, result?.geo_confidence ?? 0)),
    image_match_confidence: Math.max(0, Math.min(100, result?.image_match_confidence ?? 0)),
    entity_confidence: Math.max(0, Math.min(100, result?.entity_confidence ?? 0)),
  };
}

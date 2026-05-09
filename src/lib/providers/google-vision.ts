// Google Vision API — raw image understanding (labels, OCR, landmarks, objects)
// Results are forwarded to Mammouth for semantic interpretation. This provider
// only provides raw data; it does not score or rank anything.
//
// Config env var: GOOGLE_VISION_API_KEY

export interface VisionLabel {
  description: string;
  score: number;
}

export interface VisionObject {
  name: string;
  confidence: number;
}

export interface VisionLandmark {
  description: string;
  confidence: number;
  latitude?: number;
  longitude?: number;
}

export interface VisionAnnotation {
  labels: VisionLabel[];
  ocr_text: string;
  objects: VisionObject[];
  landmarks: VisionLandmark[];
  safe_search_adult: string;
}

const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

export function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_VISION_API_KEY);
}

export async function annotateImage(imageUrl: string): Promise<VisionAnnotation> {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) throw new Error("GOOGLE_VISION_API_KEY not configured");

  const body = {
    requests: [
      {
        image: { source: { imageUri: imageUrl } },
        features: [
          { type: "LABEL_DETECTION", maxResults: 20 },
          { type: "TEXT_DETECTION" },
          { type: "OBJECT_LOCALIZATION", maxResults: 15 },
          { type: "LANDMARK_DETECTION", maxResults: 5 },
          { type: "SAFE_SEARCH_DETECTION" },
        ],
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
    throw new Error(`Google Vision HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = await res.json() as {
    responses?: Array<{
      labelAnnotations?: Array<{ description?: string; score?: number }>;
      fullTextAnnotation?: { text?: string };
      localizedObjectAnnotations?: Array<{ name?: string; score?: number }>;
      landmarkAnnotations?: Array<{
        description?: string;
        score?: number;
        locations?: Array<{ latLng?: { latitude?: number; longitude?: number } }>;
      }>;
      safeSearchAnnotation?: { adult?: string };
      error?: { message?: string };
    }>;
  };

  const response = data.responses?.[0];
  if (response?.error?.message) {
    throw new Error(`Vision API error: ${response.error.message}`);
  }

  return {
    labels: (response?.labelAnnotations ?? []).map((l) => ({
      description: l.description ?? "",
      score: l.score ?? 0,
    })),
    ocr_text: response?.fullTextAnnotation?.text?.trim() ?? "",
    objects: (response?.localizedObjectAnnotations ?? []).map((o) => ({
      name: o.name ?? "",
      confidence: o.score ?? 0,
    })),
    landmarks: (response?.landmarkAnnotations ?? []).map((lm) => ({
      description: lm.description ?? "",
      confidence: lm.score ?? 0,
      latitude: lm.locations?.[0]?.latLng?.latitude,
      longitude: lm.locations?.[0]?.latLng?.longitude,
    })),
    safe_search_adult: response?.safeSearchAnnotation?.adult ?? "UNKNOWN",
  };
}

// Annotate multiple images and merge results
export async function annotateImages(imageUrls: string[]): Promise<VisionAnnotation[]> {
  const results: VisionAnnotation[] = [];
  for (const url of imageUrls.slice(0, 5)) {
    try {
      results.push(await annotateImage(url));
    } catch {
      // per-image errors don't abort the batch
    }
  }
  return results;
}

// Flatten multiple annotations into a concise text summary for Mammouth
export function summarizeAnnotations(annotations: VisionAnnotation[]): string {
  const allLabels = annotations.flatMap((a) => a.labels).sort((a, b) => b.score - a.score);
  const uniqueLabels = [...new Set(allLabels.map((l) => l.description))].slice(0, 20);
  const allObjects = [...new Set(annotations.flatMap((a) => a.objects).map((o) => o.name))].slice(0, 15);
  const ocrTexts = annotations.map((a) => a.ocr_text).filter(Boolean).join(" | ").slice(0, 400);
  const landmarks = annotations.flatMap((a) => a.landmarks).map((l) => l.description).filter(Boolean);

  const parts: string[] = [];
  if (uniqueLabels.length) parts.push(`Detected labels: ${uniqueLabels.join(", ")}`);
  if (allObjects.length) parts.push(`Objects found: ${allObjects.join(", ")}`);
  if (landmarks.length) parts.push(`Landmarks: ${landmarks.join(", ")}`);
  if (ocrTexts) parts.push(`OCR text: ${ocrTexts}`);

  return parts.join(". ");
}

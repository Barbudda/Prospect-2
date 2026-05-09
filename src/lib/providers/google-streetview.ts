// Google Street View Static API — fetch street-level imagery for geo hypotheses
// Images are returned as public URLs that can be passed directly to Mammouth's
// vision model for similarity scoring against listing images.
//
// Config env var: GOOGLE_PLACES_API_KEY (reuses the existing Maps Platform key)

const STREETVIEW_BASE = "https://maps.googleapis.com/maps/api/streetview";
const METADATA_BASE = "https://maps.googleapis.com/maps/api/streetview/metadata";

export interface StreetViewMetadata {
  status: "OK" | "ZERO_RESULTS" | "NOT_FOUND" | "REQUEST_DENIED" | "UNKNOWN_ERROR";
  pano_id?: string;
  date?: string;
  copyright?: string;
  location?: { lat: number; lng: number };
}

export function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export async function getMetadata(
  latitude: number,
  longitude: number
): Promise<StreetViewMetadata> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY not configured");

  const params = new URLSearchParams({
    location: `${latitude},${longitude}`,
    key,
    radius: "50",
  });

  const res = await fetch(`${METADATA_BASE}?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Street View metadata HTTP ${res.status}`);
  }

  return res.json() as Promise<StreetViewMetadata>;
}

// Returns a Street View static image URL (signed with the API key).
// These URLs can be passed directly to Mammouth's vision API.
export function getImageUrl(
  latitude: number,
  longitude: number,
  options: { heading?: number; fov?: number; pitch?: number; size?: string } = {}
): string {
  const key = process.env.GOOGLE_PLACES_API_KEY ?? "";
  const {
    heading = 0,
    fov = 90,
    pitch = 5,
    size = "640x480",
  } = options;

  const params = new URLSearchParams({
    size,
    location: `${latitude},${longitude}`,
    heading: String(heading),
    fov: String(fov),
    pitch: String(pitch),
    key,
  });

  return `${STREETVIEW_BASE}?${params}`;
}

// Fetches 4 images at different headings (N, E, S, W) for a given coordinate.
// Returns only the URLs — Mammouth will analyze their content.
export async function getMultiAngleUrls(
  latitude: number,
  longitude: number
): Promise<string[]> {
  const meta = await getMetadata(latitude, longitude);
  if (meta.status !== "OK") return [];

  return [0, 90, 180, 270].map((heading) =>
    getImageUrl(latitude, longitude, { heading, fov: 90, pitch: 5 })
  );
}

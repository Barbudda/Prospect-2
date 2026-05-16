// MAPS PROSPECTOR — discover STR operators that have a Google Business Profile.
//
// Many small property managers, gîtes, and Airbnb conciergeries are pinned on
// Google Maps with a verified phone number and website. This engine runs a set
// of STR-specific text searches against Google Places, dedupes by place_id,
// pulls Place Details for the phone + website, and optionally cross-references
// the cadastre parcel at each marker's GPS to get the cadastral reference.
//
// Output: NormalizedLead[] with strict-validated phones, ready to insert.

import type { NormalizedLead, LeadType } from "@/lib/types";
import { GooglePlacesProvider } from "@/lib/providers/google-places";
import { getParcelByCoords } from "@/lib/providers/ign-cadastre";
import { scoreLead } from "@/lib/engines/scorer";
import { generateOutreachAngle } from "@/lib/engines/outreach";
import { validatePhone, validateEmail } from "@/lib/utils/contact-validator";
import type { CountryCode } from "libphonenumber-js/max";

// Map our supported country names → ISO codes used by libphonenumber.
const COUNTRY_NAME_TO_CODE: Record<string, CountryCode> = {
  france: "FR", "united kingdom": "GB", uk: "GB", england: "GB", scotland: "GB",
  germany: "DE", deutschland: "DE", spain: "ES", españa: "ES", espana: "ES",
  italy: "IT", italia: "IT", belgium: "BE", belgique: "BE", switzerland: "CH",
  suisse: "CH", schweiz: "CH", netherlands: "NL", "pays-bas": "NL", portugal: "PT",
  ireland: "IE", austria: "AT", denmark: "DK", sweden: "SE", norway: "NO",
  finland: "FI", poland: "PL", greece: "GR", "united states": "US", usa: "US",
  canada: "CA", australia: "AU", "new zealand": "NZ", japan: "JP", brazil: "BR",
  mexico: "MX", luxembourg: "LU", monaco: "MC",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// STR-specific queries that surface operators pinned on Google Maps.
// Each query returns up to 20 results from textsearch; we'll cap at the user limit.
const DEFAULT_QUERIES = [
  "Airbnb",
  "conciergerie Airbnb",
  "location saisonnière",
  "location vacances",
  "gîte",
  "property manager",
  "vacation rental agency",
];

// Map Google Places category strings → our LeadType taxonomy
function classifyLeadType(types: string[] | undefined, name: string): LeadType {
  const haystack = ((types ?? []).join(" ") + " " + name).toLowerCase();
  if (haystack.includes("real_estate_agency") || haystack.includes("agence immobil"))
    return "Vacation Rental Agency";
  if (haystack.includes("conciergerie") || haystack.includes("concierge"))
    return "Airbnb Concierge";
  if (haystack.includes("gîte") || haystack.includes("gite") || haystack.includes("villa") || haystack.includes("chalet"))
    return "Gîte / Villa Operator";
  if (haystack.includes("lodging") || haystack.includes("hotel") || haystack.includes("hôtel"))
    return "Property Manager";
  return "Property Manager";
}

export interface MapsProspectOptions {
  city: string;
  country?: string;
  max_leads?: number;
  queries?: string[];
  enrich_cadastre?: boolean;
}

export interface MapsProspectResult {
  leads: NormalizedLead[];
  total_found: number;
  queries_used: string[];
  skipped_no_contact: number;
  skipped_invalid_phone: number;
}

export async function runMapsProspect(
  opts: MapsProspectOptions
): Promise<MapsProspectResult> {
  const {
    city,
    country = "France",
    max_leads = 30,
    queries = DEFAULT_QUERIES,
    enrich_cadastre = false,
  } = opts;

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return {
      leads: [],
      total_found: 0,
      queries_used: [],
      skipped_no_contact: 0,
      skipped_invalid_phone: 0,
    };
  }

  const places = new GooglePlacesProvider();
  const queriesToRun = queries.slice(0, 7);

  // Map place_id → most-complete record across queries (dedup)
  type MapsHit = {
    name: string;
    address?: string;
    rating?: number;
    review_count?: number;
    google_maps_url?: string;
    place_id?: string;
    website?: string;
    phone?: string;
    types?: string[];
    lat?: number;
    lng?: number;
  };

  const byPlaceId = new Map<string, MapsHit>();
  const queriesUsed: string[] = [];

  for (const query of queriesToRun) {
    if (byPlaceId.size >= max_leads * 1.5) break;

    try {
      const results = await places.searchBusinesses(
        query,
        city,
        country,
        Math.min(20, max_leads)
      );
      queriesUsed.push(query);

      for (const r of results) {
        const payload = r.raw_provider_payload as
          | { place_id?: string; types?: string[]; geometry?: { location?: { lat?: number; lng?: number } } }
          | undefined;
        const placeId = payload?.place_id ?? r.source_url ?? r.business_name;
        if (!placeId) continue;

        // Skip irrelevant types (restaurants, parking, etc.)
        const types = payload?.types ?? [];
        const isLodgingOrAgency =
          types.includes("lodging") ||
          types.includes("real_estate_agency") ||
          types.includes("establishment") ||
          types.length === 0;
        const looksRelevant =
          isLodgingOrAgency ||
          /(?:airbnb|concierg|location|vacances|gîte|gite|villa|chalet|appart|locati)/i.test(
            r.business_name
          );
        if (!looksRelevant) continue;

        const existing = byPlaceId.get(placeId);
        const merged: MapsHit = {
          name: r.business_name,
          address: r.address,
          rating: r.rating,
          review_count: r.review_count,
          google_maps_url: r.google_maps_url,
          place_id: payload?.place_id,
          website: r.website ?? existing?.website,
          phone: r.phone ?? existing?.phone,
          types,
          lat: payload?.geometry?.location?.lat,
          lng: payload?.geometry?.location?.lng,
        };
        byPlaceId.set(placeId, merged);
      }
    } catch (err) {
      console.error(
        "[MapsProspector] query failed:",
        query,
        err instanceof Error ? err.message : err
      );
    }

    await sleep(200);
  }

  // Convert to leads, validate, optionally enrich with cadastre
  const leads: NormalizedLead[] = [];
  let skippedNoContact = 0;
  let skippedInvalidPhone = 0;

  // Resolve the lookup's country to an ISO code so phones in local form
  // ("020 7946 0958" for a London listing) validate correctly. Falls back
  // to FR for unknown country strings (this product is primarily French).
  const defaultCountry: CountryCode =
    COUNTRY_NAME_TO_CODE[country.toLowerCase().trim()] ?? "FR";

  const hits = Array.from(byPlaceId.values()).slice(0, max_leads);
  for (const hit of hits) {
    // Validate phone — accepts any country, stores E.164 for dedup.
    let cleanedPhone: string | undefined;
    if (hit.phone) {
      const r = validatePhone(hit.phone, defaultCountry);
      if (r.valid && r.e164) cleanedPhone = r.e164;
      else skippedInvalidPhone++;
    }

    // Skip rows with no website AND no phone — useless leads
    if (!hit.website && !cleanedPhone) {
      skippedNoContact++;
      continue;
    }

    // Optional cadastre enrichment (France only, slow — adds ~1s per lead)
    let cadastralRef: string | undefined;
    if (enrich_cadastre && hit.lat && hit.lng && country.toLowerCase().includes("franc")) {
      try {
        const parcel = await getParcelByCoords(hit.lat, hit.lng);
        if (parcel) cadastralRef = parcel.cadastral_reference;
      } catch {
        // non-fatal
      }
      await sleep(150);
    }

    const leadType = classifyLeadType(hit.types, hit.name);
    const hasWebsite = Boolean(hit.website);

    const summaryParts = [
      `Discovered via Google Maps in ${city}.`,
      hit.rating
        ? `Google rating: ${hit.rating}${hit.review_count ? ` (${hit.review_count} reviews)` : ""}.`
        : null,
      cleanedPhone ? `Phone verified on Google Business Profile.` : null,
      hasWebsite ? `Website: ${hit.website}.` : null,
      cadastralRef ? `Cadastral parcel: ${cadastralRef}.` : null,
      !hasWebsite ? "No website — high opportunity target." : null,
    ].filter(Boolean);

    const partial: Partial<NormalizedLead> = {
      primary_name: hit.name,
      company_name: hit.name,
      lead_type: leadType,
      city,
      country,
      address: hit.address,
      website_url: hit.website,
      phone: cleanedPhone,
      source_url: hit.google_maps_url ?? "",
      source_type: "google_maps",
      google_maps_url: hit.google_maps_url,
      quality_summary: summaryParts.join(" "),
      confidence: cleanedPhone && hasWebsite ? "high" : cleanedPhone || hasWebsite ? "medium" : "low",
      status: "new",
      outreach_status: "not_contacted",
      sources: [
        {
          provider: "google_places",
          source_url: hit.google_maps_url ?? "",
          source_type: "google_maps",
          title: hit.name,
          snippet: hit.address,
          confidence: "high",
        },
      ],
      // Exclusivity heuristic: no website + verified phone = direct, less prospected
      exclusivity_score: !hasWebsite && cleanedPhone ? 85 : hasWebsite ? 50 : 35,
    };

    const { score, label } = scoreLead(partial);
    leads.push({
      ...partial,
      score,
      score_label: label,
      suggested_angle: generateOutreachAngle(leadType),
      source_url: hit.google_maps_url ?? "",
    } as NormalizedLead);
  }

  // Sort: highest score first
  leads.sort((a, b) => b.score - a.score);

  return {
    leads,
    total_found: byPlaceId.size,
    queries_used: queriesUsed,
    skipped_no_contact: skippedNoContact,
    skipped_invalid_phone: skippedInvalidPhone,
  };
}

// Silence unused-import warning when validateEmail isn't used externally
void validateEmail;

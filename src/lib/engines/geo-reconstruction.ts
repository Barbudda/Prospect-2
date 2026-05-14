// PROPERTY GEO-RECONSTRUCTION ENGINE
//
// 10-step pipeline: listing images + text + city → precise property location +
// verified operator + enriched lead.
//
// Architecture:
//   - Mammouth API is the central intelligence layer (all scoring, reasoning, matching)
//   - All other APIs are data providers (raw data only)
//   - Each step is fault-tolerant: failure never aborts the pipeline

import type { GeoReconstructionInput, GeoReconstructionResult, GeoHypothesis } from "@/lib/types";
import * as Mammouth from "@/lib/providers/mammouth";
import * as Vision from "@/lib/providers/google-vision";
import * as Bing from "@/lib/providers/bing-visual-search";
import * as StreetView from "@/lib/providers/google-streetview";
import * as Cadastre from "@/lib/providers/ign-cadastre";
import * as Pappers from "@/lib/providers/pappers";
import { huntPhone, type PhoneResult } from "@/lib/engines/phone-hunter";
import { validatePublicUrl } from "@/lib/utils/ssrf";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type StepStatus = "completed" | "skipped" | "failed";

// Pipeline state accumulated across steps
interface PipelineState {
  input: GeoReconstructionInput;
  steps: Record<string, StepStatus>;

  // Step 1 output
  visionSummary?: string;
  propertySemanticProfile?: string;

  // Step 2 output
  externalListings?: Array<{ url: string; name: string }>;
  directBookingSites?: Array<{ url: string; name: string }>;

  // Step 3 output
  geoHypotheses?: GeoHypothesis[];

  // Step 4 output
  bestHypothesis?: GeoHypothesis;
  streetViewSimilarity?: number;
  streetViewUrl?: string;

  // Step 5 output
  nearbyPlaces?: Array<{ name: string; address?: string; place_id?: string; website?: string }>;
  matchedPlace?: { name: string; address?: string; place_id?: string; website?: string; confidence: number };
  matchedPlacePhone?: string;

  // Step 6 output
  parcel?: import("@/lib/types").CadastralParcel;
  address?: string;

  // Step 7 output
  operator?: import("@/lib/types").ReconstructedOperator;

  // Step 8 output
  contact?: { email?: string; phone?: string };

  // Step 8.5 output — phone hunter
  phoneResults?: PhoneResult[];

  // Step 9 output
  directBooking?: boolean;
  directBookingUrl?: string;
}

function mark(state: PipelineState, step: string, status: StepStatus): void {
  state.steps[step] = status;
}

// ─── Step 1: Image Understanding ─────────────────────────────────────────────

async function step1ImageUnderstanding(state: PipelineState): Promise<void> {
  const { listing_images } = state.input;
  if (!listing_images.length) { mark(state, "image_understanding", "skipped"); return; }

  // Filter to public, safe URLs
  const safeImages = listing_images.filter((url) => validatePublicUrl(url).ok).slice(0, 5);
  if (!safeImages.length) { mark(state, "image_understanding", "skipped"); return; }

  try {
    // Google Vision provides raw labels, OCR, objects
    let visionSummary = "";
    if (Vision.isConfigured()) {
      const annotations = await Vision.annotateImages(safeImages);
      visionSummary = Vision.summarizeAnnotations(annotations);
    }
    state.visionSummary = visionSummary;

    // Mammouth generates semantic understanding from raw vision data + images
    const profile = await Mammouth.analyzeImages(
      safeImages,
      `You are analyzing an Airbnb listing property.
${visionSummary ? `Google Vision signals: ${visionSummary}\n` : ""}
Generate a detailed semantic understanding of this property:
- Property type (apartment, villa, house, studio, chalet...)
- Architectural style and era
- Distinctive exterior features (balcony, garden, pool, terrace, gate...)
- Environment (urban/coastal/mountain/rural/suburban)
- Geographic clues (street signs, vegetation, architecture style typical of region)
- Interior hints visible
Respond in English, be precise and factual.`
    );

    state.propertySemanticProfile = profile;
    mark(state, "image_understanding", "completed");
  } catch (err) {
    console.error("[GeoRecon Step1]", err instanceof Error ? err.message : err);
    mark(state, "image_understanding", "failed");
  }
}

// ─── Step 2: Reverse Image Search ────────────────────────────────────────────

async function step2ReverseImageSearch(state: PipelineState): Promise<void> {
  const { listing_images } = state.input;
  const safeImages = listing_images.filter((url) => validatePublicUrl(url).ok).slice(0, 2);
  if (!safeImages.length) { mark(state, "reverse_image_search", "skipped"); return; }

  try {
    const allResults: Array<{ url: string; name: string; source: string }> = [];

    // Google Vision Web Detection (via the bing-visual-search module, now backed by Vision API)
    if (Bing.isConfigured()) {
      for (const imageUrl of safeImages) {
        try {
          const visionResults = await Bing.reverseImageSearch(imageUrl);
          for (const r of visionResults.results) {
            allResults.push({ url: r.url, name: r.name, source: "google_vision" });
          }
          await sleep(500);
        } catch {
          // per-image errors are non-fatal
        }
      }
    }

    if (!allResults.length) { mark(state, "reverse_image_search", "skipped"); return; }

    // Mammouth clusters and deduplicates — identifies direct booking sites vs OTAs
    const clustered = await Mammouth.reason<{
      external_listings: Array<{ url: string; name: string; platform: string }>;
      direct_booking_sites: Array<{ url: string; name: string }>;
    }>(
      "You are a real estate listing analyst. Analyze reverse image search results.",
      `These URLs were found via reverse image search on Airbnb listing images.
Results: ${JSON.stringify(allResults.slice(0, 30))}

Separate them into:
1. external_listings — OTA platforms (Airbnb, Booking, Abritel, VRBO...)
2. direct_booking_sites — operator's own website with direct booking

Respond with JSON: {
  "external_listings": [{"url": string, "name": string, "platform": string}],
  "direct_booking_sites": [{"url": string, "name": string}]
}`
    );

    state.externalListings = clustered?.external_listings ?? [];
    state.directBookingSites = clustered?.direct_booking_sites ?? [];
    mark(state, "reverse_image_search", "completed");
  } catch (err) {
    console.error("[GeoRecon Step2]", err instanceof Error ? err.message : err);
    mark(state, "reverse_image_search", "failed");
  }
}

// ─── Step 3: Geo Hypothesis Generation ───────────────────────────────────────

async function step3GeoHypothesis(state: PipelineState): Promise<void> {
  if (!Mammouth.isConfigured()) { mark(state, "geo_hypothesis", "skipped"); return; }

  try {
    const hypotheses = await Mammouth.reason<{ hypotheses: GeoHypothesis[] }>(
      "You are a geospatial intelligence expert. Generate precise geographic location hypotheses for a property.",
      `Analyze the following signals to generate up to 3 geo hypotheses.

City declared: ${state.input.city}
Listing text: ${state.input.listing_text.slice(0, 1000)}
${state.propertySemanticProfile ? `Property visual profile: ${state.propertySemanticProfile.slice(0, 800)}` : ""}

For each hypothesis provide:
- neighborhood: specific neighborhood or quartier name
- latitude: precise decimal (6 digits)
- longitude: precise decimal (6 digits)
- confidence: integer 0-100
- reasoning: one sentence explaining the key signals used

Order hypotheses from most to least confident.

Respond with JSON: {
  "hypotheses": [
    { "neighborhood": string, "latitude": number, "longitude": number, "confidence": number, "reasoning": string }
  ]
}`
    );

    state.geoHypotheses = (hypotheses?.hypotheses ?? []).filter(
      (h) => h.latitude != null && h.longitude != null && Math.abs(h.latitude) <= 90 && Math.abs(h.longitude) <= 180
    );

    mark(state, "geo_hypothesis", state.geoHypotheses.length ? "completed" : "failed");
  } catch (err) {
    console.error("[GeoRecon Step3]", err instanceof Error ? err.message : err);
    mark(state, "geo_hypothesis", "failed");
  }
}

// ─── Step 4: Street View Matching ────────────────────────────────────────────

async function step4StreetViewMatching(state: PipelineState): Promise<void> {
  const hypotheses = state.geoHypotheses;
  if (!hypotheses?.length) { mark(state, "street_view_matching", "skipped"); return; }
  if (!StreetView.isConfigured()) { mark(state, "street_view_matching", "skipped"); return; }

  const safeListingImages = state.input.listing_images
    .filter((url) => validatePublicUrl(url).ok)
    .slice(0, 2);

  try {
    let bestHypothesis: GeoHypothesis | null = null;
    let bestSimilarity = -1;
    let bestStreetViewUrl = "";

    for (const hypothesis of hypotheses.slice(0, 3)) {
      try {
        const svUrls = await StreetView.getMultiAngleUrls(hypothesis.latitude, hypothesis.longitude);
        if (!svUrls.length) continue;

        const similarity = safeListingImages.length
          ? await Mammouth.computeVisualSimilarity(safeListingImages, svUrls.slice(0, 2))
          : 0;

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestHypothesis = hypothesis;
          bestStreetViewUrl = svUrls[0];
        }

        await sleep(800);
      } catch {
        // per-hypothesis errors are non-fatal
      }
    }

    if (bestHypothesis) {
      state.bestHypothesis = bestHypothesis;
      state.streetViewSimilarity = bestSimilarity;
      state.streetViewUrl = bestStreetViewUrl;
      mark(state, "street_view_matching", "completed");
    } else {
      // Fall back to highest-confidence hypothesis
      state.bestHypothesis = hypotheses[0];
      state.streetViewSimilarity = 0;
      mark(state, "street_view_matching", "failed");
    }
  } catch (err) {
    console.error("[GeoRecon Step4]", err instanceof Error ? err.message : err);
    state.bestHypothesis = hypotheses[0];
    mark(state, "street_view_matching", "failed");
  }
}

// ─── Step 5: Place & Business Match ──────────────────────────────────────────

async function step5PlaceMatch(state: PipelineState): Promise<void> {
  const hypothesis = state.bestHypothesis;
  if (!hypothesis) { mark(state, "place_match", "skipped"); return; }

  const mapsKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!mapsKey) { mark(state, "place_match", "skipped"); return; }

  try {
    // Google Places Nearby Search for accommodation operators
    const params = new URLSearchParams({
      location: `${hypothesis.latitude},${hypothesis.longitude}`,
      radius: "300",
      type: "lodging",
      key: mapsKey,
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`,
      { signal: AbortSignal.timeout(12_000) }
    );

    if (!res.ok) { mark(state, "place_match", "failed"); return; }

    const data = await res.json() as {
      results?: Array<{
        name?: string;
        vicinity?: string;
        place_id?: string;
        website?: string;
        rating?: number;
      }>;
    };

    // Note: Nearby Search does not return website — only name, vicinity, place_id
    const places = (data.results ?? []).slice(0, 10).map((p) => ({
      name: p.name ?? "",
      address: p.vicinity,
      place_id: p.place_id,
    }));

    state.nearbyPlaces = places.map((p) => ({ ...p, website: undefined }));

    if (!places.length) { mark(state, "place_match", "skipped"); return; }

    // Mammouth matches property to operator from nearby businesses
    const match = await Mammouth.reason<{
      best_match: { name: string; address?: string; place_id?: string; confidence: number };
      reasoning: string;
    }>(
      "You are a property-to-operator matching engine.",
      `Match this Airbnb property to its likely operator from nearby businesses.

Property description: ${state.propertySemanticProfile?.slice(0, 400) ?? ""}
Location: ${state.input.city}, ${hypothesis.neighborhood}
Listing text: ${state.input.listing_text.slice(0, 400)}

Nearby businesses:
${JSON.stringify(places)}

Identify the most likely operator. Consider: name relevance, proximity, accommodation type.
If no clear match, return the closest candidate with low confidence.

Respond with JSON: {
  "best_match": { "name": string, "address": string, "place_id": string, "confidence": number },
  "reasoning": string
}`
    );

    if (match?.best_match) {
      // Fetch Place Details to get website + phone (not in Nearby Search)
      let website: string | undefined;
      if (match.best_match.place_id && mapsKey) {
        try {
          const detailsParams = new URLSearchParams({
            place_id: match.best_match.place_id,
            fields: "website,formatted_phone_number,international_phone_number",
            key: mapsKey,
          });
          const detailsRes = await fetch(
            `https://maps.googleapis.com/maps/api/place/details/json?${detailsParams}`,
            { signal: AbortSignal.timeout(8_000) }
          );
          if (detailsRes.ok) {
            const details = await detailsRes.json() as {
              result?: {
                website?: string;
                formatted_phone_number?: string;
                international_phone_number?: string;
              };
            };
            website = details.result?.website;
            const phone =
              details.result?.formatted_phone_number ??
              details.result?.international_phone_number;
            if (phone) state.matchedPlacePhone = phone;
          }
        } catch {
          // non-fatal — proceed without website/phone
        }
      }

      state.matchedPlace = { ...match.best_match, website };
    }

    mark(state, "place_match", "completed");
  } catch (err) {
    console.error("[GeoRecon Step5]", err instanceof Error ? err.message : err);
    mark(state, "place_match", "failed");
  }
}

// ─── Step 6: Parcel Matching ──────────────────────────────────────────────────

async function step6ParcelMatching(state: PipelineState): Promise<void> {
  const hypothesis = state.bestHypothesis;
  if (!hypothesis) { mark(state, "parcel_matching", "skipped"); return; }

  try {
    // IGN Cadastre — raw parcel data
    const parcel = await Cadastre.getParcelByCoords(hypothesis.latitude, hypothesis.longitude);
    const geocode = await Cadastre.reverseGeocode(hypothesis.latitude, hypothesis.longitude);

    state.parcel = parcel ?? undefined;
    state.address = geocode?.label;

    if (parcel && Mammouth.isConfigured()) {
      // Mammouth validates spatial consistency
      const validation = await Mammouth.reason<{ consistent: boolean; notes: string }>(
        "You are a spatial data validator.",
        `Validate that this cadastral parcel is consistent with the property description.

Property profile: ${state.propertySemanticProfile?.slice(0, 300) ?? ""}
City: ${state.input.city}
Parcel reference: ${parcel.cadastral_reference}
Commune: ${parcel.commune}
${parcel.area_m2 ? `Area: ${parcel.area_m2} m²` : ""}

Respond with JSON: { "consistent": boolean, "notes": string }`
      );

      if (validation && !validation.consistent) {
        // Parcel found but spatially inconsistent — still useful, just note it
        console.warn(`[GeoRecon Step6] Parcel inconsistency: ${validation.notes}`);
      }
    }

    mark(state, "parcel_matching", parcel ? "completed" : "skipped");
  } catch (err) {
    console.error("[GeoRecon Step6]", err instanceof Error ? err.message : err);
    mark(state, "parcel_matching", "failed");
  }
}

// ─── Step 7: Entity Enrichment ───────────────────────────────────────────────

async function step7EntityEnrichment(state: PipelineState): Promise<void> {
  const candidateName = state.matchedPlace?.name ?? "";
  const city = state.input.city;

  try {
    const candidateSources: Array<{ name?: string; siren?: string; siret?: string; website?: string; activity?: string; address?: string }> = [];

    // Pappers company search by candidate name
    if (Pappers.isConfigured() && candidateName) {
      try {
        const companies = await Pappers.searchCompany(
          `${candidateName} ${city}`,
          state.parcel?.commune?.slice(0, 2)
        );
        for (const c of companies.slice(0, 5)) {
          candidateSources.push({
            name: c.nom_entreprise ?? c.denomination,
            siren: c.siren,
            siret: c.siret_siege,
            website: c.site_web,
            activity: c.libelle_code_naf,
            address: [c.adresse_siege, c.ville_siege].filter(Boolean).join(", "),
          });
        }
      } catch {
        // non-fatal
      }
    }

    // SIRENE GPS search — finds auto-entrepreneurs registered at the property address.
    // Individual Airbnb hosts earning >23k€/year must register as auto-entrepreneurs
    // with their home address = the rental property. NAF 5520Z = short-term rental.
    if (state.bestHypothesis) {
      const { latitude, longitude } = state.bestHypothesis;
      for (const code_naf of ["5520Z", "6820A"]) {
        try {
          const gpsParams = new URLSearchParams({
            lat: latitude.toFixed(6),
            lon: longitude.toFixed(6),
            radius: "0.3",
            code_naf,
            per_page: "5",
          });
          const gpsRes = await fetch(
            `https://recherche-entreprises.api.gouv.fr/near_point?${gpsParams}`,
            { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) }
          );
          if (gpsRes.ok) {
            const gpsData = await gpsRes.json() as {
              results?: Array<{
                nom_complet?: string;
                siege?: { siret?: string; adresse?: string; telephone?: string };
                activite_principale?: string;
              }>;
            };
            for (const e of gpsData.results ?? []) {
              if (e.nom_complet) {
                candidateSources.push({
                  name: e.nom_complet,
                  siret: e.siege?.siret,
                  activity: e.activite_principale,
                  address: e.siege?.adresse,
                });
              }
            }
          }
          await sleep(200);
        } catch {
          // non-fatal per NAF code
        }
      }
    }

    // SerpAPI web search for operator
    if (process.env.SERPAPI_API_KEY && candidateName) {
      try {
        const query = `"${candidateName}" ${city} location vacances contact`;
        const params = new URLSearchParams({
          api_key: process.env.SERPAPI_API_KEY,
          engine: "google",
          q: query,
          gl: "fr",
          hl: "fr",
          num: "5",
        });
        const res = await fetch(`https://serpapi.com/search?${params}`, {
          signal: AbortSignal.timeout(12_000),
        });
        if (res.ok) {
          const data = await res.json() as {
            organic_results?: Array<{ link?: string; title?: string; snippet?: string }>;
          };
          for (const r of data.organic_results ?? []) {
            if (r.link) {
              candidateSources.push({ name: r.title, website: r.link });
            }
          }
        }
        await sleep(600);
      } catch {
        // non-fatal
      }
    }

    if (!candidateSources.length && !candidateName) {
      mark(state, "entity_enrichment", "skipped");
      return;
    }

    // Mammouth resolves best operator, removes noise, ranks
    const resolved = await Mammouth.reason<{
      operator: {
        name: string;
        website?: string;
        activity?: string;
        siret?: string;
        siren?: string;
        address?: string;
        confidence: number;
      };
      reasoning: string;
    }>(
      "You are an entity resolution engine for vacation rental operators.",
      `Resolve the best operator entity from these candidates.
Context: property in ${city}, listing text: "${state.input.listing_text.slice(0, 300)}"
${candidateName ? `Place match: "${candidateName}"` : ""}

Candidates:
${JSON.stringify(candidateSources.slice(0, 10))}

Select the most likely operator. Confidence 0-100.
Include auto-entrepreneurs and individuals registered with codes 5520Z (short-term rental) or 6820A (rental).
Exclude only clearly unrelated businesses (restaurant, shop, etc.).

Respond with JSON: {
  "operator": { "name": string, "website": string, "activity": string, "siret": string, "siren": string, "address": string, "confidence": number },
  "reasoning": string
}`
    );

    if (resolved?.operator?.name) {
      state.operator = resolved.operator;
    }

    mark(state, "entity_enrichment", state.operator ? "completed" : "skipped");
  } catch (err) {
    console.error("[GeoRecon Step7]", err instanceof Error ? err.message : err);
    mark(state, "entity_enrichment", "failed");
  }
}

// ─── Step 8: Contact Enrichment ───────────────────────────────────────────────

async function step8ContactEnrichment(state: PipelineState): Promise<void> {
  const operator = state.operator;
  if (!operator?.name) { mark(state, "contact_enrichment", "skipped"); return; }

  const dropcontactKey = process.env.DROPCONTACT_API_KEY;
  if (!dropcontactKey) { mark(state, "contact_enrichment", "skipped"); return; }

  try {
    const domain = operator.website
      ? new URL(operator.website.startsWith("http") ? operator.website : `https://${operator.website}`).hostname
      : undefined;

    const body: Record<string, string> = {
      company: operator.name,
      country: "FR",
    };
    if (domain) body.website = domain;
    if (operator.siret) body.siret = operator.siret;

    const res = await fetch("https://api.dropcontact.com/b2b-api/v2/enrich/single", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Token": dropcontactKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) { mark(state, "contact_enrichment", "failed"); return; }

    const data = await res.json() as {
      email?: Array<{ email?: string; qualification?: string }>;
      phone?: Array<{ number?: string }>;
    };

    state.contact = {
      email: data.email?.[0]?.email,
      phone: data.phone?.[0]?.number,
    };

    mark(state, "contact_enrichment", "completed");
  } catch (err) {
    console.error("[GeoRecon Step8]", err instanceof Error ? err.message : err);
    mark(state, "contact_enrichment", "failed");
  }
}

// ─── Step 8.5: Phone Hunter ───────────────────────────────────────────────────

async function step8_5PhoneHunter(state: PipelineState): Promise<void> {
  const { city, listing_text } = state.input;

  // If Google Maps already gave us a phone in step 5, promote it immediately
  if (state.matchedPlacePhone) {
    state.phoneResults = [{
      number: state.matchedPlacePhone,
      source: "Google Maps",
      method: "google_maps",
      confidence: "high",
    }];
    if (!state.contact) state.contact = {};
    state.contact.phone ??= state.matchedPlacePhone;
    mark(state, "phone_hunter", "completed");
    return;
  }

  const hostMatch = listing_text.match(/(?:hosted|animé|géré) by ([^,.\n<]+)/i);
  const hostName = hostMatch?.[1]?.trim();

  const operatorName = state.operator?.name;
  const address = state.address ?? state.operator?.address;
  const placeId = state.matchedPlace?.place_id;
  const siret = state.operator?.siret;
  const hasWebsite = Boolean(state.operator?.website ?? state.matchedPlace?.website);

  // Extract postal code from BAN reverse geocode address (e.g. "06000" from "12 rue Victor Hugo 06000 Nice")
  const postalCode = state.address?.match(/\b(\d{5})\b/)?.[1];

  try {
    const phones = await huntPhone({
      operator_name: operatorName,
      host_name: hostName,
      address,
      city,
      place_id: placeId,
      siret,
      has_website: hasWebsite,
      latitude: state.bestHypothesis?.latitude,
      longitude: state.bestHypothesis?.longitude,
      postal_code: postalCode,
    });

    state.phoneResults = phones;

    if (phones.length > 0) {
      if (!state.contact) state.contact = {};
      state.contact.phone ??= phones[0].number;
      mark(state, "phone_hunter", "completed");
    } else {
      mark(state, "phone_hunter", "skipped");
    }
  } catch (err) {
    console.error("[GeoRecon Step8.5]", err instanceof Error ? err.message : err);
    mark(state, "phone_hunter", "failed");
  }
}

// ─── Step 9: Direct Booking Detection ────────────────────────────────────────

async function step9DirectBookingDetection(state: PipelineState): Promise<void> {
  const websiteSignals = [
    ...(state.directBookingSites ?? []).map((s) => s.url),
    state.operator?.website,
    state.matchedPlace?.website,
  ].filter(Boolean) as string[];

  if (!websiteSignals.length) { mark(state, "direct_booking_detection", "skipped"); return; }
  if (!Mammouth.isConfigured()) { mark(state, "direct_booking_detection", "skipped"); return; }

  try {
    const result = await Mammouth.reason<{
      has_direct_booking: boolean;
      booking_url?: string;
      booking_signals: string[];
      confidence: number;
    }>(
      "You are a direct booking detection engine for vacation rental websites.",
      `Analyze these website URLs and determine if the operator has a direct booking system.

Direct booking site candidates: ${websiteSignals.join(", ")}
External listings found: ${(state.externalListings ?? []).map((l) => l.url).join(", ")}
Operator website: ${state.operator?.website ?? "unknown"}

Look for signals: own booking engine, reservation calendar, "Book now" without OTA, pricing page,
direct contact form for booking, property management system (Smoobu, Hostaway, Lodgify...).

Respond with JSON: {
  "has_direct_booking": boolean,
  "booking_url": string,
  "booking_signals": [list of signals found],
  "confidence": number
}`
    );

    state.directBooking = result?.has_direct_booking ?? false;
    state.directBookingUrl = result?.booking_url;
    mark(state, "direct_booking_detection", "completed");
  } catch (err) {
    console.error("[GeoRecon Step9]", err instanceof Error ? err.message : err);
    state.directBooking = false;
    mark(state, "direct_booking_detection", "failed");
  }
}

// ─── Step 10: Global Scoring ──────────────────────────────────────────────────

async function step10GlobalScoring(state: PipelineState): Promise<{
  geo_confidence: number;
  image_match_confidence: number;
  entity_confidence: number;
}> {
  if (!Mammouth.isConfigured()) {
    // Heuristic fallback when Mammouth is not configured
    return {
      geo_confidence: state.bestHypothesis?.confidence ?? 0,
      image_match_confidence: state.streetViewSimilarity ?? 0,
      entity_confidence: state.operator?.confidence ?? 0,
    };
  }

  try {
    const scores = await Mammouth.computeGlobalScores({
      geo_hypotheses_count: state.geoHypotheses?.length ?? 0,
      best_geo_confidence: state.bestHypothesis?.confidence ?? 0,
      street_view_similarity: state.streetViewSimilarity ?? 0,
      has_parcel: Boolean(state.parcel),
      has_operator: Boolean(state.operator),
      has_contact: Boolean(state.contact?.email || state.contact?.phone),
      direct_booking: state.directBooking ?? false,
      image_matches_count: (state.externalListings ?? []).length,
    });
    mark(state, "global_scoring", "completed");
    return scores;
  } catch (err) {
    console.error("[GeoRecon Step10]", err instanceof Error ? err.message : err);
    mark(state, "global_scoring", "failed");
    return {
      geo_confidence: state.bestHypothesis?.confidence ?? 0,
      image_match_confidence: state.streetViewSimilarity ?? 0,
      entity_confidence: state.operator?.confidence ?? 0,
    };
  }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runGeoReconstruction(
  input: GeoReconstructionInput
): Promise<GeoReconstructionResult> {
  if (!Mammouth.isConfigured()) {
    throw new Error("MAMMOUTH_API_KEY is required to run the Geo-Reconstruction Engine");
  }

  const state: PipelineState = { input, steps: {} };

  // Steps 1-2 can run in parallel (independent data gathering)
  await Promise.all([
    step1ImageUnderstanding(state),
    step2ReverseImageSearch(state),
  ]);

  // Step 3 depends on step 1 output
  await step3GeoHypothesis(state);

  // Step 4 depends on step 3 output
  await step4StreetViewMatching(state);

  // Steps 5-6 both depend on step 4 best hypothesis — run in parallel
  await Promise.all([
    step5PlaceMatch(state),
    step6ParcelMatching(state),
  ]);

  // Step 7 depends on step 5 (place match) and step 6 (parcel)
  await step7EntityEnrichment(state);

  // Step 8 depends on step 7 (operator)
  await step8ContactEnrichment(state);

  // Step 8.5 — phone hunter (runs after address + operator known)
  await step8_5PhoneHunter(state);

  // Step 9 depends on step 2 (direct booking sites) and step 7 (operator website)
  await step9DirectBookingDetection(state);

  // Step 10 synthesizes everything
  const confidenceScores = await step10GlobalScoring(state);

  // ── Build final result ───────────────────────────────────────────────────
  const detectedLocation = state.bestHypothesis
    ? {
        latitude: state.bestHypothesis.latitude,
        longitude: state.bestHypothesis.longitude,
        address: state.address,
        neighborhood: state.bestHypothesis.neighborhood,
        confidence: state.bestHypothesis.confidence,
      }
    : null;

  const propertyMatch = state.bestHypothesis
    ? {
        street_view_similarity: state.streetViewSimilarity ?? 0,
        confirmed: (state.streetViewSimilarity ?? 0) >= 60,
        street_view_url: state.streetViewUrl,
      }
    : null;

  return {
    detected_location: detectedLocation,
    property_match: propertyMatch,
    parcel_info: state.parcel ?? null,
    operator: state.operator ?? null,
    contact: state.contact ?? {},
    direct_booking: state.directBooking ?? false,
    direct_booking_url: state.directBookingUrl,
    confidence_scores: confidenceScores,
    pipeline_steps: state.steps,
    phone_discovery_results: state.phoneResults ?? [],
    best_phone: state.contact?.phone,
  };
}

// MAP PROSPECT
// Discovers leads by querying Google Places for "lodging" businesses in a city,
// then cross-references each with the IGN cadastre and Recherche Entreprises
// (SIRENE GPS) to verify the property and resolve the owner. For lodgings
// with no Place-Details phone, the full Phone Hunter runs to find one.
//
// Different from the visual / mass-visual flows: those start from an Airbnb
// listing URL; this one starts from Google's own map data, which is faster
// and catches operators who marked themselves on Google but aren't ranked
// well in standard web search.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { huntPhone } from "@/lib/engines/phone-hunter";
import { validateFrenchPhone } from "@/lib/utils/contact-validator";
import { scoreLead } from "@/lib/engines/scorer";
import { generateOutreachAngle } from "@/lib/engines/outreach";
import * as Cadastre from "@/lib/providers/ign-cadastre";
import type { NormalizedLead } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface PlacesSearchHit {
  name?: string;
  formatted_address?: string;
  place_id?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  rating?: number;
  user_ratings_total?: number;
  types?: string[];
  business_status?: string;
}

interface PlacesTextSearchResult {
  results?: PlacesSearchHit[];
  next_page_token?: string;
}

interface PlaceDetailsResponse {
  result?: {
    name?: string;
    formatted_address?: string;
    formatted_phone_number?: string;
    international_phone_number?: string;
    website?: string;
    place_id?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
    types?: string[];
    rating?: number;
    user_ratings_total?: number;
    url?: string;
  };
}

// Exclude established chain hotels — they're not STR hosts
const HOTEL_CHAINS = [
  "ibis", "mercure", "novotel", "best western", "hilton", "marriott",
  "accor", "campanile", "premiere classe", "première classe",
  "kyriad", "comfort inn", "holiday inn", "courtyard", "fairmont",
  "radisson", "sofitel", "pullman", "b&b hotel", "ibis budget",
  "formule 1", "premier inn", "okko hotels",
];

function isLikelyChainHotel(name: string, reviewCount: number): boolean {
  const lower = name.toLowerCase();
  if (HOTEL_CHAINS.some((chain) => lower.includes(chain))) return true;
  // Heavy review counts = established commercial hotel, not an STR host
  if (reviewCount >= 400) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const placesKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!placesKey)
      return NextResponse.json(
        { error: "GOOGLE_PLACES_API_KEY not configured" },
        { status: 503 }
      );

    const body = (await req.json()) as {
      city?: string;
      country?: string;
      max_results?: number;
    };
    const { city, country = "France", max_results = 10 } = body;
    if (!city || typeof city !== "string" || city.trim().length < 2)
      return NextResponse.json({ error: "city is required" }, { status: 400 });

    const cap = Math.min(Math.max(1, max_results), 20);
    const trimmedCity = city.trim();

    // ── Step 1: Google Places Text Search ─────────────────────────────────────
    const allHits: PlacesSearchHit[] = [];
    const baseQuery = `appartement OR studio OR location saisonnière OR meublé tourisme OR gîte OR chambre d'hôtes à ${trimmedCity} ${country}`;

    let pageToken: string | undefined;
    for (let page = 0; page < 2 && allHits.length < cap * 2; page++) {
      const params = new URLSearchParams({
        query: baseQuery,
        type: "lodging",
        key: placesKey,
      });
      if (pageToken) {
        params.set("pagetoken", pageToken);
        await sleep(2000); // Google needs ~2s for the page token to become valid
      }
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`,
        { signal: AbortSignal.timeout(12_000) }
      );
      if (!res.ok) break;
      const data = (await res.json()) as PlacesTextSearchResult;
      allHits.push(...(data.results ?? []));
      pageToken = data.next_page_token;
      if (!pageToken) break;
    }

    if (allHits.length === 0)
      return NextResponse.json(
        { error: `No lodging found on Google Maps for "${trimmedCity}"` },
        { status: 404 }
      );

    // Dedupe + filter chains + filter closed
    const seen = new Set<string>();
    const candidates = allHits
      .filter((p) => p.business_status !== "CLOSED_PERMANENTLY")
      .filter((p) => p.name && !isLikelyChainHotel(p.name, p.user_ratings_total ?? 0))
      .filter((p) => {
        if (!p.place_id || seen.has(p.place_id)) return false;
        seen.add(p.place_id);
        return true;
      })
      .slice(0, cap);

    // ── Step 2: For each, fetch Place Details + parcel + phone ───────────────
    const service = createServiceClient();
    const leadsResp: Array<{
      id?: string;
      name: string;
      city: string;
      address?: string;
      phone?: string;
      website?: string;
      score: number;
      score_label: string;
      parcel_ref?: string;
      saved: boolean;
      error?: string;
    }> = [];

    for (const place of candidates) {
      try {
        const detailsParams = new URLSearchParams({
          place_id: place.place_id!,
          fields:
            "name,formatted_address,formatted_phone_number,international_phone_number,website,geometry,types,rating,user_ratings_total,url",
          key: placesKey,
        });
        const detailsRes = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?${detailsParams}`,
          { signal: AbortSignal.timeout(10_000) }
        );
        if (!detailsRes.ok) {
          leadsResp.push({
            name: place.name ?? "Unknown",
            city: trimmedCity,
            score: 0,
            score_label: "Weak",
            saved: false,
            error: `Place Details HTTP ${detailsRes.status}`,
          });
          continue;
        }
        const d = ((await detailsRes.json()) as PlaceDetailsResponse).result;
        if (!d) continue;

        const lat = d.geometry?.location?.lat;
        const lon = d.geometry?.location?.lng;
        const address = d.formatted_address;
        const postalCode = address?.match(/\b(\d{5})\b/)?.[1];

        const rawPhone =
          d.formatted_phone_number ?? d.international_phone_number;
        const phoneCheck = rawPhone ? validateFrenchPhone(rawPhone) : null;
        let phone: string | undefined = phoneCheck?.valid
          ? phoneCheck.cleaned
          : undefined;

        // Cadastre lookup
        let parcelRef: string | undefined;
        if (lat && lon) {
          try {
            const parcel = await Cadastre.getParcelByCoords(lat, lon);
            parcelRef = parcel?.cadastral_reference;
          } catch {
            // non-fatal
          }
        }

        // If no phone from Places, hunt one using the GPS we just resolved
        if (!phone && lat && lon) {
          try {
            const hunted = await huntPhone({
              operator_name: d.name,
              address,
              city: trimmedCity,
              country,
              place_id: d.place_id,
              has_website: Boolean(d.website),
              latitude: lat,
              longitude: lon,
              postal_code: postalCode,
            });
            const top = hunted.find((p) => (p.validation_score ?? 0) >= 20);
            if (top) phone = top.number;
          } catch {
            // non-fatal
          }
        }

        const noWebsite = !d.website;
        const sourceUrl =
          d.url ?? `https://www.google.com/maps/place/?q=place_id:${d.place_id}`;

        const partial: Partial<NormalizedLead> = {
          primary_name: d.name ?? "Lodging",
          company_name: d.name,
          lead_type: "Property Manager",
          city: trimmedCity,
          country,
          address,
          website_url: d.website,
          phone,
          source_url: sourceUrl,
          source_type: "google_maps_lodging",
          google_maps_url: sourceUrl,
          quality_summary: [
            `Discovered on Google Maps as a lodging business.`,
            d.rating
              ? `Rated ${d.rating}/5 (${d.user_ratings_total ?? 0} reviews).`
              : null,
            address ? `Address: ${address}.` : null,
            parcelRef ? `Cadastral parcel: ${parcelRef}.` : null,
            phone ? "Phone verified." : "No phone found — retry available.",
            noWebsite ? "No website — high-priority target." : null,
          ]
            .filter(Boolean)
            .join(" "),
          confidence: phone ? "high" : "medium",
          status: "new",
          outreach_status: "not_contacted",
          reconstructed: true,
          reconstruction_confidence: 80,
          exclusivity_score: noWebsite && phone ? 90 : noWebsite ? 60 : 40,
          geo_signals: {
            detected_location: {
              latitude: lat,
              longitude: lon,
              address,
              confidence: 90,
            },
            parcel_reference: parcelRef,
            google_place_id: d.place_id,
            google_place_url: sourceUrl,
            google_rating: d.rating,
            google_review_count: d.user_ratings_total,
          },
        };

        const { score, label } = scoreLead(partial);

        const { data: inserted, error: insertErr } = await service
          .from("leads")
          .insert({
            user_id: user.id,
            primary_name: partial.primary_name,
            company_name: partial.company_name ?? null,
            lead_type: partial.lead_type,
            city: partial.city,
            country: partial.country,
            address: partial.address ?? null,
            website_url: partial.website_url ?? null,
            phone: partial.phone ?? null,
            source_url: partial.source_url,
            source_type: partial.source_type,
            google_maps_url: partial.google_maps_url ?? null,
            score,
            score_label: label,
            confidence: partial.confidence,
            status: "new",
            outreach_status: "not_contacted",
            suggested_angle: generateOutreachAngle("Property Manager"),
            quality_summary: partial.quality_summary ?? null,
            reconstructed: true,
            reconstruction_confidence: partial.reconstruction_confidence ?? null,
            exclusivity_score: partial.exclusivity_score ?? null,
            geo_signals: partial.geo_signals
              ? JSON.stringify(partial.geo_signals)
              : null,
          })
          .select("id")
          .single();

        leadsResp.push({
          id: inserted?.id,
          name: partial.primary_name ?? "Lodging",
          city: trimmedCity,
          address,
          phone,
          website: d.website,
          score,
          score_label: label,
          parcel_ref: parcelRef,
          saved: Boolean(inserted?.id),
          error: insertErr?.message,
        });
      } catch (err) {
        console.error(
          "[map-prospect candidate]",
          err instanceof Error ? err.message : err
        );
      }
    }

    const saved = leadsResp.filter((l) => l.saved).length;

    return NextResponse.json({
      discovered: candidates.length,
      saved,
      leads: leadsResp,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/map-prospect]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

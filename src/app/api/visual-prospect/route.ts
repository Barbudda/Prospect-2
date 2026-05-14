import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { scrapeListingImages } from "@/lib/engines/listing-scraper";
import { runGeoReconstruction } from "@/lib/engines/geo-reconstruction";
import { scoreLead, getScoreLabel } from "@/lib/engines/scorer";
import { generateOutreachAngle } from "@/lib/engines/outreach";
import { validatePublicUrl } from "@/lib/utils/ssrf";
import type { GeoReconstructionResult, NormalizedLead } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Convert geo-reconstruction output → NormalizedLead for DB persistence
function toNormalizedLead(
  result: GeoReconstructionResult,
  sourceUrl: string,
  city: string,
  country: string,
  scrapedTitle?: string
): NormalizedLead {
  const { operator, contact, detected_location, confidence_scores, direct_booking, parcel_info, phone_discovery_results } = result;

  const name = operator?.name ?? scrapedTitle ?? sourceUrl;
  const bestPhone = result.best_phone || contact.phone || undefined;
  const bestPhoneResult = phone_discovery_results?.[0];
  const noWebsite = !operator?.website;

  const partial: Partial<NormalizedLead> = {
    primary_name: name,
    company_name: operator?.name,
    lead_type: "Property Manager",
    city: detected_location?.neighborhood
      ? `${city} — ${detected_location.neighborhood}`
      : city,
    country,
    address: detected_location?.address ?? operator?.address,
    website_url: operator?.website,
    email: contact.email || undefined,
    phone: bestPhone,
    source_url: sourceUrl,
    source_type: "visual_reconstruction",
    quality_summary: [
      operator?.name ? `Operator identified: ${operator.name}.` : null,
      operator?.activity ? `Activity: ${operator.activity}.` : null,
      operator?.siret ? `SIRET: ${operator.siret}.` : null,
      detected_location
        ? `Geo located in ${detected_location.neighborhood ?? city} (confidence ${detected_location.confidence}%).`
        : null,
      direct_booking ? "Direct booking site detected." : null,
      parcel_info
        ? `Cadastral parcel: ${parcel_info.cadastral_reference}.`
        : null,
      bestPhoneResult
        ? `Phone found via ${bestPhoneResult.source} (${bestPhoneResult.confidence} confidence).`
        : null,
      noWebsite ? "No website — high opportunity target." : null,
    ]
      .filter(Boolean)
      .join(" "),
    confidence:
      confidence_scores.entity_confidence >= 70
        ? "high"
        : confidence_scores.entity_confidence >= 40
        ? "medium"
        : "low",
    status: "new",
    outreach_status: "not_contacted",
    // Reconstruction layer
    reconstruction_confidence: Math.round(
      (confidence_scores.geo_confidence + confidence_scores.image_match_confidence) / 2
    ),
    // Exclusivity reflects how hard this lead is to find via standard channels:
    //   - No website + reachable phone     → ~95 (unreachable through any B2B DB)
    //   - Direct booking site              → ~80 (active operator, less common)
    //   - Operator with website            → ~40 (probably already prospected)
    exclusivity_score: noWebsite && bestPhone ? 95 : direct_booking ? 80 : 40,
    reconstructed: true,
    geo_signals: {
      detected_location,
      confidence_scores,
      pipeline_steps: result.pipeline_steps,
      direct_booking_url: result.direct_booking_url,
    },
  };

  const { score, label } = scoreLead(partial);

  return {
    ...partial,
    score,
    score_label: label,
    suggested_angle: generateOutreachAngle("Property Manager"),
    source_url: sourceUrl,
  } as NormalizedLead;
}

export async function POST(req: NextRequest) {
  try {
    // Auth
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      url?: string;
      city?: string;
      country?: string;
    };

    const { url, city, country = "France" } = body;

    if (!url || typeof url !== "string")
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    if (!city || typeof city !== "string" || city.trim().length < 2)
      return NextResponse.json({ error: "city is required" }, { status: 400 });

    // SSRF check on listing URL
    if (!validatePublicUrl(url).ok)
      return NextResponse.json({ error: "Invalid or blocked URL" }, { status: 400 });

    if (!process.env.MAMMOUTH_API_KEY)
      return NextResponse.json(
        { error: "MAMMOUTH_API_KEY is not configured" },
        { status: 503 }
      );

    // ── Step A: Scrape listing images ────────────────────────────────────────
    const scraped = await scrapeListingImages(url);
    if (!scraped.images.length)
      return NextResponse.json(
        { error: "No images could be extracted from this listing URL" },
        { status: 422 }
      );

    // ── Step B: Run geo-reconstruction pipeline ──────────────────────────────
    const reconstruction = await runGeoReconstruction({
      listing_images: scraped.images,
      listing_text: [scraped.title, scraped.description, scraped.raw_text]
        .filter(Boolean)
        .join(". ")
        .slice(0, 2000),
      city: city.trim(),
      country,
    });

    // ── Step C: Convert to lead and save ─────────────────────────────────────
    const lead = toNormalizedLead(
      reconstruction,
      url,
      city.trim(),
      country,
      scraped.title
    );

    const serviceSupabase = createServiceClient();
    const { data: inserted, error: insertError } = await serviceSupabase
      .from("leads")
      .insert({
        user_id: user.id,
        primary_name: lead.primary_name,
        company_name: lead.company_name ?? null,
        lead_type: lead.lead_type,
        city: lead.city,
        country: lead.country,
        address: lead.address ?? null,
        website_url: lead.website_url ?? null,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        source_url: lead.source_url,
        source_type: lead.source_type,
        score: lead.score,
        score_label: lead.score_label,
        confidence: lead.confidence,
        status: "new",
        outreach_status: "not_contacted",
        suggested_angle: lead.suggested_angle ?? null,
        quality_summary: lead.quality_summary ?? null,
        reconstruction_confidence: lead.reconstruction_confidence ?? null,
        exclusivity_score: lead.exclusivity_score ?? null,
        reconstructed: true,
        geo_signals: lead.geo_signals ? JSON.stringify(lead.geo_signals) : null,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[visual-prospect] DB insert error:", insertError.message);
    }

    return NextResponse.json({
      lead_id: inserted?.id ?? null,
      lead: { ...lead, id: inserted?.id },
      reconstruction,
      images: scraped.images,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/visual-prospect]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

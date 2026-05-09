import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runGeoReconstruction } from "@/lib/engines/geo-reconstruction";
import { validatePublicUrl } from "@/lib/utils/ssrf";
import type { GeoReconstructionInput } from "@/lib/types";

export const dynamic = "force-dynamic";

// Maximum runtime — pipeline has many sequential API calls
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    // Auth
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate input
    const body = await req.json() as Partial<GeoReconstructionInput>;

    const { listing_images, listing_text, city, country = "France" } = body;

    if (!city || typeof city !== "string" || city.trim().length < 2) {
      return NextResponse.json({ error: "city is required" }, { status: 400 });
    }

    if (!listing_text || typeof listing_text !== "string") {
      return NextResponse.json({ error: "listing_text is required" }, { status: 400 });
    }

    if (!Array.isArray(listing_images) || listing_images.length === 0) {
      return NextResponse.json({ error: "listing_images array is required (min 1 URL)" }, { status: 400 });
    }

    // SSRF validation — only allow public, safe image URLs
    const validatedImages: string[] = [];
    for (const url of listing_images) {
      if (typeof url !== "string") continue;
      const check = validatePublicUrl(url);
      if (check.ok) {
        validatedImages.push(url);
      }
    }

    if (validatedImages.length === 0) {
      return NextResponse.json(
        { error: "No valid public image URLs provided" },
        { status: 400 }
      );
    }

    // Check Mammouth is configured before starting the expensive pipeline
    if (!process.env.MAMMOUTH_API_KEY) {
      return NextResponse.json(
        { error: "MAMMOUTH_API_KEY is not configured. The geo-reconstruction engine requires Mammouth API." },
        { status: 503 }
      );
    }

    const input: GeoReconstructionInput = {
      listing_images: validatedImages.slice(0, 5),
      listing_text: listing_text.slice(0, 3000),
      city: city.trim(),
      country: typeof country === "string" ? country.trim() : "France",
    };

    const result = await runGeoReconstruction(input);

    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/geo-reconstruct]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

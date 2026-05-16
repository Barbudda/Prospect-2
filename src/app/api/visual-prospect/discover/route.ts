// Discovery endpoint for mass visual prospecting.
// Runs individual host finder and returns sorted Airbnb listing URLs.
// Called by the client before sequentially processing each listing
// through the full geo-reconstruction pipeline.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runIndividualHostFinder } from "@/lib/engines/individual-host-finder";

export const dynamic = "force-dynamic";
export const maxDuration = 55;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!process.env.SERPAPI_API_KEY)
      return NextResponse.json(
        { error: "SERPAPI_API_KEY not configured — add it in Settings." },
        { status: 503 }
      );

    const body = (await req.json()) as {
      city?: string;
      country?: string;
      max_listings?: number;
    };

    const { city, country = "France", max_listings = 10 } = body;

    if (!city || typeof city !== "string" || city.trim().length < 2)
      return NextResponse.json({ error: "city is required" }, { status: 400 });

    // Cap at 15 to preserve SerpAPI quota (~10 searches per run)
    const cap = Math.min(Math.max(1, max_listings), 15);

    const leads = await runIndividualHostFinder(
      city.trim(),
      country,
      cap * 2, // fetch more, then trim to cap
      // minReviews intentionally not set — the Airbnb search-page parser
      // doesn't reliably surface per-listing review counts, so any non-zero
      // floor here drops every listing. The host-finder still filters by
      // hostName/title presence, which is enough.
      { platform: "airbnb" }
    );

    // Superhosts first, then most reviews
    const sorted = [...leads].sort((a, b) => {
      const aS = a.superhost ? 1 : 0;
      const bS = b.superhost ? 1 : 0;
      if (aS !== bS) return bS - aS;
      return (b.review_count ?? 0) - (a.review_count ?? 0);
    });

    const listings = sorted
      .filter((l) => !!l.source_url)
      .slice(0, cap)
      .map((l) => ({
        url: l.source_url!,
        title: l.listing_title ?? l.primary_name,
        host_name: l.person_name ?? undefined,
        superhost: l.superhost ?? false,
        review_count: l.review_count ?? null,
      }));

    return NextResponse.json({ listings, total_found: leads.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/visual-prospect/discover]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

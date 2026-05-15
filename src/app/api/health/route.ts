// GET /api/health
// One-shot health check against every reachable provider. Returns latency,
// status, and the configuration flag per provider. Used by /health UI page.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ProviderHealth {
  name: string;
  category: "ai" | "search" | "places" | "scraper" | "registry" | "enrichment" | "db";
  configured: boolean;
  reachable: boolean | null;
  status_code?: number;
  latency_ms?: number;
  notes?: string;
}

async function probe(
  name: string,
  category: ProviderHealth["category"],
  test: () => Promise<{ status: number; latency_ms: number; notes?: string }>
): Promise<ProviderHealth> {
  const t0 = Date.now();
  try {
    const r = await test();
    return {
      name,
      category,
      configured: true,
      reachable: r.status >= 200 && r.status < 400,
      status_code: r.status,
      latency_ms: r.latency_ms,
      notes: r.notes,
    };
  } catch (err) {
    return {
      name,
      category,
      configured: true,
      reachable: false,
      latency_ms: Date.now() - t0,
      notes: err instanceof Error ? err.message : "probe failed",
    };
  }
}

async function timedFetch(url: string, init?: RequestInit): Promise<{ status: number; latency_ms: number }> {
  const t0 = Date.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
  return { status: res.status, latency_ms: Date.now() - t0 };
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const results: ProviderHealth[] = [];

  // ── AI ─────────────────────────────────────────────────────────────────
  if (process.env.MAMMOUTH_API_KEY) {
    results.push(
      await probe("Mammouth", "ai", async () => {
        const base = process.env.MAMMOUTH_BASE_URL ?? "https://api.mammouth.ai/v1";
        const r = await timedFetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MAMMOUTH_API_KEY}`,
          },
          body: JSON.stringify({
            model: process.env.MAMMOUTH_CHAT_MODEL ?? "gpt-4o",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 3,
          }),
        });
        return r;
      })
    );
  } else {
    results.push({ name: "Mammouth", category: "ai", configured: false, reachable: null });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    results.push(
      await probe("Anthropic (Claude)", "ai", async () =>
        timedFetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
        })
      )
    );
  } else {
    results.push({ name: "Anthropic (Claude)", category: "ai", configured: false, reachable: null });
  }

  // ── Search ─────────────────────────────────────────────────────────────
  if (process.env.SERPAPI_API_KEY) {
    results.push(
      await probe("SerpAPI (fallback only)", "search", async () =>
        timedFetch(
          `https://serpapi.com/search?api_key=${process.env.SERPAPI_API_KEY}&engine=google&q=test&num=1`
        )
      )
    );
  } else {
    results.push({ name: "SerpAPI (fallback only)", category: "search", configured: false, reachable: null });
  }

  // ── Places + Vision + StreetView (Google) ──────────────────────────────
  if (process.env.GOOGLE_PLACES_API_KEY) {
    results.push(
      await probe("Google Places", "places", async () =>
        timedFetch(
          `https://maps.googleapis.com/maps/api/place/textsearch/json?query=test&key=${process.env.GOOGLE_PLACES_API_KEY}`
        )
      )
    );
  } else {
    results.push({ name: "Google Places", category: "places", configured: false, reachable: null });
  }

  if (process.env.GOOGLE_VISION_API_KEY) {
    // Vision needs a POST body; HEAD-style check via discovery endpoint
    results.push(
      await probe("Google Vision", "places", async () =>
        timedFetch(
          `https://vision.googleapis.com/$discovery/rest?version=v1`
        )
      )
    );
  } else {
    results.push({ name: "Google Vision", category: "places", configured: false, reachable: null });
  }

  // ── Scrapers (no env key — code reachability) ──────────────────────────
  const scraperHosts = [
    { name: "Airbnb (direct)", url: "https://www.airbnb.com/s/Paris/homes" },
    { name: "Abritel (direct)", url: "https://www.abritel.fr/results?q=Paris" },
    { name: "Clévacances (direct)", url: "https://www.clevacances.com/fr/recherche?text=Paris" },
  ];
  for (const s of scraperHosts) {
    results.push(
      await probe(s.name, "scraper", async () =>
        timedFetch(s.url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "fr-FR,fr;q=0.9",
          },
        })
      )
    );
    await sleep(200);
  }

  // ── Free public registries ─────────────────────────────────────────────
  results.push(
    await probe("Recherche Entreprises (gouv)", "registry", async () =>
      timedFetch("https://recherche-entreprises.api.gouv.fr/search?q=test&per_page=1")
    )
  );
  results.push(
    await probe("IGN Cadastre", "registry", async () =>
      timedFetch("https://apicarto.ign.fr/api/cadastre/parcelle?lon=2.35&lat=48.85&_limit=1")
    )
  );
  results.push(
    await probe("BAN (api-adresse)", "registry", async () =>
      timedFetch("https://api-adresse.data.gouv.fr/search/?q=paris&limit=1")
    )
  );
  results.push(
    await probe("DVF (cquest)", "registry", async () =>
      timedFetch("https://api.cquest.org/dvf?lat=48.85&lon=2.35&dist=20")
    )
  );

  if (process.env.PAPPERS_API_KEY) {
    results.push(
      await probe("Pappers", "registry", async () =>
        timedFetch(
          `https://api.pappers.fr/v2/recherche?api_token=${process.env.PAPPERS_API_KEY}&q=test&par_page=1`
        )
      )
    );
  } else {
    results.push({ name: "Pappers", category: "registry", configured: false, reachable: null });
  }

  // ── DB ─────────────────────────────────────────────────────────────────
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    results.push(
      await probe("Supabase", "db", async () => {
        const t0 = Date.now();
        const { error } = await supabase.from("leads").select("id", { count: "exact", head: true });
        return { status: error ? 500 : 200, latency_ms: Date.now() - t0, notes: error?.message };
      })
    );
  } else {
    results.push({ name: "Supabase", category: "db", configured: false, reachable: null });
  }

  const summary = {
    total: results.length,
    configured: results.filter((r) => r.configured).length,
    reachable: results.filter((r) => r.reachable === true).length,
    unreachable: results.filter((r) => r.configured && r.reachable === false).length,
  };

  return NextResponse.json({ summary, providers: results });
}

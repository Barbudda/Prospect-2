import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { provider } = await req.json();

  try {
    switch (provider) {
      case "SerpAPI": {
        if (!process.env.SERPAPI_API_KEY) {
          return NextResponse.json({ ok: false, error: "API key not configured" });
        }
        const res = await fetch(
          `https://serpapi.com/search?api_key=${process.env.SERPAPI_API_KEY}&engine=google&q=test&num=1`,
          { signal: AbortSignal.timeout(10_000) }
        );
        if (res.status === 401) {
          return NextResponse.json({
            ok: false,
            error: "Provider test failed: SerpAPI returned 401 Unauthorized. Check your API key in Settings.",
          });
        }
        return NextResponse.json({ ok: res.ok, status: res.status });
      }

      case "Brave Search": {
        if (!process.env.BRAVE_SEARCH_API_KEY) {
          return NextResponse.json({ ok: false, error: "API key not configured" });
        }
        const res = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
          headers: { "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY! },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          return NextResponse.json({
            ok: false,
            error: `Brave Search returned HTTP ${res.status}. Check your API key in Settings.`,
          });
        }
        return NextResponse.json({ ok: true });
      }

      case "Google Places": {
        if (!process.env.GOOGLE_PLACES_API_KEY) {
          return NextResponse.json({ ok: false, error: "API key not configured" });
        }
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/place/textsearch/json?query=test&key=${process.env.GOOGLE_PLACES_API_KEY}`,
          { signal: AbortSignal.timeout(10_000) }
        );
        const data = await res.json();
        if (data.status === "REQUEST_DENIED") {
          return NextResponse.json({
            ok: false,
            error: `Google Places: ${data.error_message ?? "Request denied — check your API key."}`,
          });
        }
        return NextResponse.json({ ok: true });
      }

      case "Hunter.io": {
        if (!process.env.HUNTER_API_KEY) {
          return NextResponse.json({ ok: false, error: "API key not configured" });
        }
        const res = await fetch(
          `https://api.hunter.io/v2/account?api_key=${process.env.HUNTER_API_KEY}`,
          { signal: AbortSignal.timeout(10_000) }
        );
        if (!res.ok) {
          return NextResponse.json({ ok: false, error: `Hunter.io returned HTTP ${res.status}` });
        }
        return NextResponse.json({ ok: true });
      }

      case "Tavily": {
        if (!process.env.TAVILY_API_KEY) {
          return NextResponse.json({ ok: false, error: "TAVILY_API_KEY not configured" });
        }
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: "test", max_results: 1 }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          return NextResponse.json({ ok: false, error: `Tavily returned HTTP ${res.status} — check your API key` });
        }
        return NextResponse.json({ ok: true });
      }

      case "Claude (Anthropic)": {
        if (!process.env.ANTHROPIC_API_KEY) {
          return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY not configured" });
        }
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          return NextResponse.json({ ok: false, error: `Anthropic returned HTTP ${res.status} — check your API key` });
        }
        return NextResponse.json({ ok: true });
      }

      // ── Direct platform scrapers — reachability ping (HEAD + tiny GET) ──
      case "Airbnb (direct)":
      case "Abritel (direct)":
      case "Clévacances (direct)": {
        const targetHost =
          provider === "Airbnb (direct)" ? "https://www.airbnb.com/s/Paris/homes"
          : provider === "Abritel (direct)" ? "https://www.abritel.fr/results?q=Paris"
          : "https://www.clevacances.com/fr/recherche?text=Paris";
        const t0 = Date.now();
        try {
          const r = await fetch(targetHost, {
            method: "GET",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              Accept: "text/html",
              "Accept-Language": "fr-FR,fr;q=0.9",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(12_000),
          });
          const dur = Date.now() - t0;
          if (r.status === 429 || r.status === 503) {
            return NextResponse.json({
              ok: false,
              error: `${provider} returned ${r.status} from this IP (bot wall). Production IP may pass. Latency ${dur}ms.`,
            });
          }
          if (!r.ok) {
            return NextResponse.json({
              ok: false,
              error: `${provider} returned HTTP ${r.status}. Latency ${dur}ms.`,
            });
          }
          return NextResponse.json({ ok: true, status: r.status, latency_ms: dur });
        } catch (e) {
          return NextResponse.json({
            ok: false,
            error: `${provider} unreachable: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }

      case "Gîtes de France (fallback)": {
        if (!process.env.SERPAPI_API_KEY) {
          return NextResponse.json({
            ok: false,
            error: "Gîtes uses a SerpAPI site:gites-de-france.com fallback (search page is JS-rendered). Configure SERPAPI_API_KEY to enable.",
          });
        }
        return NextResponse.json({ ok: true, status: 200, note: "SerpAPI fallback active" });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown provider: ${provider}` });
    }
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

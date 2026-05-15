import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ProviderStatusInfo } from "@/lib/types";

function getEnvKey(name: string): string | undefined {
  const map: Record<string, string> = {
    "Claude (Anthropic)": "ANTHROPIC_API_KEY",
    SerpAPI: "SERPAPI_API_KEY",
    "Brave Search": "BRAVE_SEARCH_API_KEY",
    "Google Programmable Search": "GOOGLE_PROGRAMMABLE_SEARCH_API_KEY",
    "Bing Web Search": "BING_WEB_SEARCH_API_KEY",
    Tavily: "TAVILY_API_KEY",
    Exa: "EXA_API_KEY",
    "Google Places": "GOOGLE_PLACES_API_KEY",
    Outscraper: "OUTSCRAPER_API_KEY",
    Apify: "APIFY_API_KEY",
    "Hunter.io": "HUNTER_API_KEY",
    Dropcontact: "DROPCONTACT_API_KEY",
    "Apollo.io": "APOLLO_API_KEY",
    Prospeo: "PROSPEO_API_KEY",
    FullEnrich: "FULLENRICH_API_KEY",
    "People Data Labs": "PEOPLE_DATA_LABS_API_KEY",
    "Snov.io": "SNOV_API_KEY",
    Kaspr: "KASPR_API_KEY",
  };
  return map[name];
}

const PROVIDERS: Array<{ name: string; type: ProviderStatusInfo["type"]; description: string }> = [
  // AI
  { name: "Claude (Anthropic)", type: "ai", description: "AI outreach email writer — requires ANTHROPIC_API_KEY" },
  // Search
  { name: "SerpAPI", type: "search", description: "Google Search via SerpAPI" },
  { name: "Brave Search", type: "search", description: "Brave Web Search API" },
  { name: "Google Programmable Search", type: "search", description: "Google Custom Search Engine" },
  { name: "Bing Web Search", type: "search", description: "Microsoft Bing Search" },
  { name: "Tavily", type: "search", description: "Tavily AI Search API" },
  { name: "Exa", type: "search", description: "Exa.ai Neural Search" },
  // Local Business
  { name: "Google Places", type: "local_business", description: "Google Maps Places API" },
  { name: "Outscraper", type: "local_business", description: "Outscraper Google Maps" },
  { name: "Apify", type: "local_business", description: "Apify Actors (Maps, Search)" },
  // Direct platform scrapers (no API key, no env var — reachability is the health metric)
  { name: "Airbnb (direct)", type: "str_data", description: "Direct search-page scraper — parses embedded listingId JSON" },
  { name: "Abritel (direct)", type: "str_data", description: "Direct HTML scraper — search by city + listing-detail phone extraction" },
  { name: "Gîtes de France (fallback)", type: "str_data", description: "Search is JS-rendered upstream — uses SerpAPI site:gites-de-france.com fallback" },
  { name: "Clévacances (direct)", type: "str_data", description: "Direct HTML scraper — /fr/hebergement/<id> pattern" },
  // Enrichment
  { name: "Hunter.io", type: "enrichment", description: "Email finder & verifier" },
  { name: "Dropcontact", type: "enrichment", description: "B2B email enrichment (GDPR)" },
  { name: "Apollo.io", type: "enrichment", description: "B2B contact database" },
  { name: "Prospeo", type: "enrichment", description: "Email enrichment" },
  { name: "FullEnrich", type: "enrichment", description: "Multi-provider enrichment" },
  { name: "People Data Labs", type: "enrichment", description: "Person & company data" },
  { name: "Snov.io", type: "enrichment", description: "Email finder & outreach" },
  { name: "Kaspr", type: "enrichment", description: "LinkedIn contact enrichment" },
  // STR
  { name: "BlueBox by Vintory", type: "str_data", description: "STR owner prospecting platform" },
  { name: "AirDNA", type: "str_data", description: "Short-term rental analytics" },
  { name: "Mashvisor", type: "str_data", description: "Rental property analytics" },
];

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const DIRECT_SCRAPERS = new Set([
    "Airbnb (direct)",
    "Abritel (direct)",
    "Clévacances (direct)",
  ]);
  const FALLBACK_GATED = new Set(["Gîtes de France (fallback)"]);

  const statuses: ProviderStatusInfo[] = PROVIDERS.map((p) => {
    const envKey = getEnvKey(p.name);
    let status: ProviderStatusInfo["status"] = "disabled";

    if (DIRECT_SCRAPERS.has(p.name)) {
      // No API key — always "configured" because the scraper is code, not a key
      status = "configured";
    } else if (FALLBACK_GATED.has(p.name)) {
      // Reachable only when SerpAPI is configured (since Gîtes search is JS-rendered)
      status = process.env.SERPAPI_API_KEY ? "configured" : "missing_key";
    } else if (p.type === "str_data") {
      status = "disabled";
    } else if (envKey && process.env[envKey]) {
      status = "configured";
    } else {
      status = "missing_key";
    }

    return { name: p.name, type: p.type, status, description: p.description };
  });

  return NextResponse.json({ providers: statuses });
}

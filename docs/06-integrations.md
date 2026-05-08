# Integrations

## Search Providers (implement in priority order)
- Priority 1: SerpAPI — most reliable, Google results, 100 free/month — `SERPAPI_API_KEY`
- Priority 1: Brave Search — good alternative, 2000 free/month — `BRAVE_SEARCH_API_KEY`
- Priority 2: Tavily — AI-optimized, 1000 free/month — `TAVILY_API_KEY`
- Priority 3: Google Custom Search — 100 free/day — `GOOGLE_PROGRAMMABLE_SEARCH_API_KEY`
- Priority 3: Exa — neural search — `EXA_API_KEY`
- Priority 3: Bing Web Search — `BING_WEB_SEARCH_API_KEY`

## Local Business Providers
- Priority 1: Google Places API — best coverage — `GOOGLE_PLACES_API_KEY`
- Priority 1: SerpAPI Google Maps — shares SERPAPI_API_KEY — `SERPAPI_API_KEY`
- Priority 2: Outscraper — Google Maps scraper — `OUTSCRAPER_API_KEY`
- Priority 2: Apify — Maps actor — `APIFY_API_KEY`

## Enrichment Providers
- Priority 1: Hunter.io — email finder, 25 free/month — `HUNTER_API_KEY`
- Priority 1: Dropcontact — GDPR-compliant B2B enrichment — `DROPCONTACT_API_KEY`
- Priority 2: Apollo.io — large database — `APOLLO_API_KEY`
- Priority 2: Prospeo — `PROSPEO_API_KEY`
- Priority 3: FullEnrich — multi-provider — `FULLENRICH_API_KEY`
- Priority 3: People Data Labs — `PEOPLE_DATA_LABS_API_KEY`
- Priority 3: Snov.io — `SNOV_API_KEY`
- Priority 3: Kaspr — LinkedIn enrichment — `KASPR_API_KEY`

## Provider detection logic
At startup and before each run:
- Check which env vars are present and non-empty via `process.env`
- Build list of active providers
- If zero search providers configured: block run, show setup instructions
- If enrichment not configured: skip enrichment, mark as not enriched
- If local provider configured: add as additional source
- Provider test buttons make real API calls to verify connectivity

---
description: Check which API keys are configured in .env.local for the Prospect Airbnb project
allowed-tools: Bash(cat *) Read
user-invocable: true
disable-model-invocation: false
---

## Task

Read the current `.env.local` file and tell me exactly which keys are set (non-empty) vs missing, grouped by category.

!`[ -f .env.local ] && cat .env.local || echo "FILE_NOT_FOUND: .env.local does not exist. Run: cp .env.local.example .env.local"`

## Report format

Show a table with three groups:

**Required (Supabase)**
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

**Search Providers** (need at least one)
- SERPAPI_API_KEY
- BRAVE_SEARCH_API_KEY
- GOOGLE_PROGRAMMABLE_SEARCH_API_KEY
- BING_WEB_SEARCH_API_KEY
- TAVILY_API_KEY
- EXA_API_KEY

**Local Business Providers** (optional but recommended)
- GOOGLE_PLACES_API_KEY
- OUTSCRAPER_API_KEY
- APIFY_API_KEY

**Enrichment Providers** (optional)
- HUNTER_API_KEY
- DROPCONTACT_API_KEY
- APOLLO_API_KEY

For each key: ✅ set | ❌ missing

End with a one-line summary: what works right now and what to add first for best results.
Do NOT show the actual key values.

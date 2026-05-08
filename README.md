# Prospect Airbnb Leads V1

Automated B2B lead generation for finding contactable Airbnb-related businesses.

## Quick Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure Supabase

Create a project at [supabase.com](https://supabase.com), then run the migration:

- Open your Supabase dashboard → SQL Editor
- Paste and run the contents of `supabase/migrations/001_initial_schema.sql`

### 3. Configure environment variables
```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` — your Supabase service role key

Then add **at least one search provider** key:
- `SERPAPI_API_KEY` — [serpapi.com](https://serpapi.com) (recommended)
- `BRAVE_SEARCH_API_KEY` — [brave.com/search/api](https://brave.com/search/api)
- `GOOGLE_PLACES_API_KEY` — Google Cloud Console

### 4. Run the app
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Demo Flow

1. Open the app and sign up / sign in
2. Enter **City**: `Biarritz`, **Country**: `France`
3. Click **Find Leads**
4. Watch real-time progress — sources → contacts → scoring
5. Browse leads table, open any lead for full details
6. Export CSV for outreach

---

## Providers

All API keys are set via environment variables. No keys are ever stored in the database.

| Provider | Type | Variable |
|---|---|---|
| SerpAPI | Web Search | `SERPAPI_API_KEY` |
| Brave Search | Web Search | `BRAVE_SEARCH_API_KEY` |
| Google Places | Local Business | `GOOGLE_PLACES_API_KEY` |
| Hunter.io | Enrichment | `HUNTER_API_KEY` |
| Dropcontact | Enrichment | `DROPCONTACT_API_KEY` |

Full list in `.env.local.example`.

---

## Architecture

```
User → Dashboard → POST /api/runs/create → /runs/[id] (progress)
                         ↓ background
                   POST /api/runs/[id]/start
                         ↓
                   Orchestrator:
                     Engine 1: Local Business Search (Google Places, SerpAPI Maps)
                     Engine 2: Web Search Discovery (SerpAPI, Brave)
                     Engine 3: Website Contact Extraction
                     Engine 4: Enrichment (Hunter, Dropcontact)
                     Deduplication → Scoring → Persist to Supabase
                         ↓
                   GET /api/runs/[id]/status (polls every 3s)
                         ↓
                   /leads?run=[id] → Lead detail → CSV export
```

## Compliance

This tool collects only publicly available business information for professional B2B outreach. All leads are sourced from public web pages, business directories, and official APIs. It does not bypass authentication or scrape private data. All outreach records include opt-out tracking.

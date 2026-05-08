# Architecture

## Stack
- Framework: Next.js 16 App Router (uses `src/proxy.ts`, not `middleware.ts`)
- Language: TypeScript strict mode
- Database: Supabase Postgres with RLS
- Auth: Supabase Auth (SSR with @supabase/ssr)
- Styling: TailwindCSS + shadcn/ui v4 (base-ui — no asChild prop on Button)
- Hosting: Vercel
- HTTP client: native fetch with timeout and SSRF validation
- HTML parsing: cheerio / native regex

## Critical Next.js 16 differences
- Auth proxy: `src/proxy.ts` (export named `proxy`, NOT `middleware.ts`)
- `export const dynamic = "force-dynamic"` required on all auth-gated pages
- `createBrowserClient` must be lazy-imported inside async event handlers to avoid build-time crashes
- Select `onValueChange` types as `string | null` — always check for null

## Folder structure
```
src/
  app/
    api/
      runs/create/route.ts
      runs/[id]/start/route.ts
      runs/[id]/status/route.ts
      runs/[id]/cancel/route.ts
      leads/route.ts
      leads/[id]/route.ts
      export/csv/route.ts
      providers/status/route.ts
      providers/test/route.ts
    (app)/
      page.tsx                  → Search form (dashboard)
      layout.tsx                → Authenticated layout with Nav
      runs/[id]/page.tsx        → Progress view
      leads/page.tsx            → Leads table
      leads/[id]/page.tsx       → Lead detail
      settings/page.tsx         → Provider config
    login/
      page.tsx                  → Login / signup
    layout.tsx                  → Root layout
  lib/
    engines/
      query-generator.ts        → Generate search queries
      contact-extractor.ts      → Extract contacts from websites
      classifier.ts             → Classify lead type by keywords
      scorer.ts                 → Score lead 0-100
      deduplicator.ts           → Deduplicate by domain + fuzzy name
      outreach.ts               → Outreach angle templates
      orchestrator.ts           → Full pipeline coordinator
    providers/
      serpapi-search.ts         → SerpAPI Google Search
      serpapi-maps.ts           → SerpAPI Google Maps
      brave-search.ts           → Brave Search API
      google-places.ts          → Google Places API
      hunter.ts                 → Hunter.io enrichment
      dropcontact.ts            → Dropcontact enrichment
    supabase/
      client.ts                 → Browser client (lazy-loaded)
      server.ts                 → Server client + service role client
    types.ts                    → All shared TypeScript types
    utils/
      ssrf.ts                   → SSRF protection (blocklist validation)
      url.ts                    → URL, email, phone utilities + Levenshtein
  components/
    nav.tsx                     → Top navigation
    ui/                         → shadcn/ui v4 components
  proxy.ts                      → Auth proxy (Next.js 16)
```

## Data flow
```
User submits form
→ POST /api/runs/create → insert run (status=queued), return run_id
→ Redirect to /runs/[id]
→ POST /api/runs/[id]/start → orchestrator begins async (fire-and-forget)
    → query-generator: generate 10-20 targeted queries
    → Engine 1: local business providers → normalised leads
    → Engine 2: web search providers → normalised leads
    → Engine 3: website extractor → enriched contacts on each lead
    → Engine 4: enrichment providers → email lookup
    → deduplicator: merge leads by domain / fuzzy name
    → scorer: calculate final score per lead
    → persist all leads to DB
    → update run status = completed
→ Frontend polls GET /api/runs/[id]/status every 3 seconds
→ On status=completed: View Leads link appears
```

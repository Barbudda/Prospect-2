# Product Requirements — V1

## Core user flow (must work end-to-end)
1. User logs in (Supabase Auth)
2. User fills form: city, country, target type, number of leads
3. User clicks "Find Leads"
4. System runs fully automated pipeline — zero manual action needed
5. User watches live progress with status updates
6. User sees leads table with real results
7. User opens lead detail with full evidence and contact info
8. User exports CSV and starts prospecting

## Must-have in V1 (non-negotiable)
- Supabase Auth (email/password)
- Search run creation and orchestration that actually executes
- At least 1 real working web search provider (SerpAPI or Brave)
- Real website contact extractor using cheerio or native fetch
- Lead deduplication by domain
- Lead scoring 0-100 with label (Hot / Good / Medium / Weak)
- Lead type classification using keyword matching
- Template-based outreach angles per lead type
- Supabase persistence with RLS
- CSV export that works
- Settings page for API key configuration
- Graceful degradation when providers are not configured
- Compliance notice visible in UI
- App builds without TypeScript errors
- App runs without crashes

## Must-NOT in V1
- No fake / mock / seeded leads anywhere
- No Airbnb.com scraping
- No image, Street View, or cadastral features
- No CRM workflows
- No manual copy-paste as the main workflow
- No broken infinite pipelines

## Run configuration limits
- maxSearchQueries: 20
- maxResultsPerQuery: 10
- maxWebsitesToCrawl: 100
- maxPagesPerWebsite: 8
- pageTimeoutMs: 10000
- crawlerConcurrency: 3
- maxLeadsReturned: 250
- delayBetweenRequestsMs: 1000

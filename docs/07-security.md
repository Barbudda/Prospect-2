# Security Rules

## API Keys
- Never in client-side code
- Never in browser bundles (all providers run server-side only)
- Never logged to console or DB
- Never stored in database (env vars only)
- Only in server-side environment variables (`process.env`)

## SSRF Protection (mandatory before every HTTP fetch)
File: `src/lib/utils/ssrf.ts`

Block all requests to:
- localhost, 127.0.0.1, 0.0.0.0, ::1
- 169.254.169.254 (cloud metadata endpoint)
- metadata.google.internal
- 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (private ranges)
- file://, ftp://, data://, javascript:// protocols

Only allow: http:// and https:// with public hostnames.

The `validatePublicUrl()` function must be called before every external fetch
that originates from user-supplied or scraped URLs. Provider API calls
(SerpAPI, Brave, etc.) do not need SSRF validation since their URLs are hardcoded.

## Input validation
- city and country validated server-side in /api/runs/create
- All URL inputs from crawled pages pass through validatePublicUrl()
- Max length enforced on lead fields at the DB level

## Supabase RLS
- Row Level Security enabled on ALL user data tables
- Policy on leads, search_runs, lead_sources, etc.: `USING (auth.uid() = user_id)`
- Service role key: server-side only (orchestrator), never exposed to browser
- Anon key: used for auth session management and client-side reads with RLS

## Auth
- `src/proxy.ts` (Next.js 16 auth proxy) guards all non-public routes
- Public paths: /login, /api/* (API routes handle auth themselves)
- Unauthenticated requests redirected to /login
- Authenticated requests to /login redirected to /

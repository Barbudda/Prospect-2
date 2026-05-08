@AGENTS.md

# CLAUDE.md

## Project
Prospect Airbnb Leads V1 — Automated B2B lead generation for Airbnb-related operators.

## Primary objective
MAKE THE APP WORK WITH REAL DATA.
Not a demo. Not a prototype. A working automated lead generation tool.

## Read before starting any task
- /docs/00-vision.md
- /docs/02-product-requirements.md
- /docs/03-architecture.md
- /docs/04-data-model.md
- /docs/07-security.md

## Critical Next.js 16 / shadcn v4 constraints
- Auth proxy: `src/proxy.ts` — export named `proxy` (NOT middleware.ts)
- `export const dynamic = "force-dynamic"` on every auth-gated page
- shadcn/ui v4 uses `@base-ui/react/button` — NO `asChild` prop on Button
- Select `onValueChange` types as `string | null` — always guard with `if (v)`
- `createBrowserClient` must be lazy-imported inside async handlers, never at module level

## Absolute rules
1. NEVER create fake leads, emails, phones, names, or URLs
2. NEVER expose API keys to client-side code or browser bundles
3. NEVER skip SSRF validation (`validatePublicUrl`) before any user-supplied URL fetch
4. NEVER break TypeScript strict mode (zero implicit any)
5. NEVER preserve broken or mock code for compatibility reasons
6. ALWAYS save partial results to DB progressively during long runs
7. ALWAYS log errors and progress to search_run_logs table
8. ALWAYS show honest empty states when no data is found
9. ALWAYS run `npm run build` before declaring a task complete
10. ALWAYS verify real API calls are made (not mocked) in production paths

## Code standards
- TypeScript strict: true
- Zero implicit any
- Named exports preferred
- Server actions / API routes for all mutations
- Supabase service role for orchestrator (server-side writes)
- Supabase anon key for client-side reads (with RLS)
- All external fetch calls from crawled URLs must pass validatePublicUrl() first
- All errors must be caught, logged to search_run_logs, and handled gracefully

## Definition of "working"
The app is working when:
1. `npm run build` succeeds with zero errors
2. `npm run dev` starts without crashes
3. A user can log in
4. A user can enter a city and click Find Leads
5. Real search queries are sent to a real configured provider (visible in run logs)
6. Real URLs are crawled for contact information
7. Real leads appear in the table (or honest empty state if none found)
8. CSV export downloads a valid file
9. Settings page shows real provider statuses (configured vs missing_key)
10. All of the above works without fake data anywhere

## Provider env vars
| Provider | Env var |
|---|---|
| SerpAPI | SERPAPI_API_KEY |
| Brave Search | BRAVE_SEARCH_API_KEY |
| Google Places | GOOGLE_PLACES_API_KEY |
| Hunter.io | HUNTER_API_KEY |
| Dropcontact | DROPCONTACT_API_KEY |
| Apollo.io | APOLLO_API_KEY |

## When in doubt
Check /docs/ first.
Build less. Make it work. Make it real.

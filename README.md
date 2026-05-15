# Prospect Airbnb — Lead Intelligence Engine

B2B lead intelligence for the French short-term rental market. Finds operators, validates their public contacts, scores opportunity, and produces compliance-aware outreach drafts — all from public + open-data sources.

Live: **prospect-2.vercel.app**

---

## Quick start

```bash
npm install
cp .env.local.example .env.local        # fill in keys
npm run dev                              # http://localhost:3000
npm test                                 # 17 parser tests
npm run build                            # production build
```

**Minimum env keys**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus at least one of `SERPAPI_API_KEY` / `GOOGLE_PLACES_API_KEY` / `MAMMOUTH_API_KEY`.

---

## Pages

| Path | What it does |
|---|---|
| `/dashboard` | Cross-portfolio overview: top leads, clusters, revenue upside, weird-signal frequency, compliance health |
| `/visual` | Visual prospecting — paste an Airbnb URL or scan a city for individual hosts via mass mode |
| `/maps` | Google Maps operator discovery for a city |
| `/ecosystem` | Reverse-concierge view: partner suppliers around a city + outreach templates |
| `/operators` | Hidden multi-property operator clusters with one-click merge |
| `/partners` | Classify leads as customer-targets vs potential partners |
| `/review` | Human-in-the-loop verification queue |
| `/tasks` | Follow-ups, verifications, compliance escalations |
| `/leads` and `/leads/[id]` | Lead list + per-lead Intelligence Hub (signals, contact paths, dossier, audit, timeline) |
| `/health` | Real-time reachability + latency probe across every provider |
| `/runs` | Batch search runs |
| `/settings` | Provider key status |

---

## Data sources

**Free + open-data (no key)**
- Recherche Entreprises (gouv.fr SIRENE)
- IGN Cadastre (apicarto.ign.fr)
- BAN — Base Adresse Nationale
- DVF — Demandes de Valeurs Foncières (cquest.org)
- Sit@del2 — French building-permit database (data.gouv.fr)
- 4 direct platform scrapers: Airbnb · Abritel · Gîtes de France · Clévacances

**Configured by key**
- Mammouth (AI brain — required for visual reconstruction)
- Google Vision · Google Places · Google Street View
- Pappers (SIRENE Premium)
- Anthropic Claude (outreach writer)
- Hunter.io · Dropcontact (B2B enrichment, optional)
- SerpAPI (allow-listed fallback only — gates direct-scrape platforms)

See `/health` in the running app for live reachability per provider.

---

## Architecture in one paragraph

Engines under `src/lib/engines/` orchestrate the work. Providers under `src/lib/providers/` are pure data sources. Engines call providers through `search-router.ts` which enforces an allow-list (queries targeting our directly-scraped platforms cannot route to SerpAPI). API routes under `src/app/api/` are thin: auth + validation + engine call + DB write. Pages under `src/app/(app)/` are client components consuming the APIs.

```
Discovery (Visual / Maps / Orchestrator / Mass Prospect)
  → Strict contact validation (validators reject CSS, JS, URL-encoded garbage)
  → Phone Hunter (8 methods + cross-validation + early-exit)
  → Operator clustering (hidden multi-property detection)
  → Weird signal scanner (13 high-intent opportunity flags)
  → Website auditor
  → Review-intelligence amenity-gap signals
  → Partner-vs-target classification
  → Entity graph relationships
  → DVF property history + Sit@del2 permit cross-reference
  → Lead Dossier (Mammouth synthesis + multi-channel outreach drafts)
  → Contact Path Finder (10 lawful channels with risk + consent flags)
  → Opportunity Scoring v2 (quality / confidence / compliance-safety)
  → Compliance helpers (lawful basis, retention, suppression, DNC)
  → Human-in-the-loop review queue + tasks + merge
  → Prioritization Dashboard
  → Inbound Intent Capture
  → Excel + CSV export
```

---

## Compliance — non-negotiables

- Public, lawful, partner-provided, or consent-based sources only.
- No bypassing platform ToS or scraping behind authentication.
- GDPR-aware per-data-point lawful basis tracking and retention dates (`src/lib/utils/compliance.ts`).
- Suppression / Do-Not-Contact list honoured at every save site.
- Strict contact-format validation before any record is stored or exported.

---

## Migrations (optional upgrade path)

`docs/migrations/001_search_cache_and_suppression.sql` adds:
- `search_cache` — persistent KV cache surviving Vercel cold starts
- `lead_suppression` — email/phone DNC list per user (with RLS)
- `lead_compliance_records` — per-data-point audit
- `graph_relationships` — persisted entity-graph edges

App runs without these tables (in-memory cache + per-lead DNC). Apply when ready — the code auto-detects.

---

## Roadmap status

18 of 20 lead-intelligence features in production. The two not built are explicit deferrals:
- **#10 Demand Spike Detector** — requires paid events/weather APIs
- **#19 Microservices Architecture** — current monolith handles MVP/V1 scale

Full detail: `docs/lead-intelligence-roadmap.md`.

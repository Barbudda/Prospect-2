# Lead Intelligence Engine — Roadmap

A staged plan for turning the current discovery tool into a full Lead Intelligence
Engine for the French short-term rental market. Each feature lists what it does,
why it finds better leads, what we already have, what to build, the compliance
constraint, and a "safe implementation path".

**Hard constraints (apply to every feature below)**
- Public, lawful, partner-provided, open-data, or consent-based sources only.
- No bypassing platform ToS, no scraping behind authentication, no impersonation.
- GDPR + ePrivacy: lawful basis recorded per data point, retention dates, opt-out
  tracking, source URL, processing purpose, suppression list honored on write.
- B2B-first targeting (auto-entrepreneurs operating commercially are B2B in this
  context); strict data minimisation for natural persons.

---

## Status legend

- ✅ **Shipped** — in production today
- 🚧 **In progress** — partially built
- 📋 **Specced** — designed below, not yet built
- 🧪 **Experiment** — high-risk / high-reward, behind a feature flag

---

## What's already in production

| Capability | Where it lives |
|---|---|
| Web orchestrator (search → crawl → contacts) | `src/lib/engines/orchestrator.ts` |
| Visual reconstruction pipeline (Airbnb URL → operator) | `src/lib/engines/geo-reconstruction.ts` |
| Mass Airbnb discovery via SerpAPI site:airbnb | `src/lib/engines/individual-host-finder.ts` |
| Maps Prospect (Google Places + cadastre) | `src/lib/engines/maps-prospector.ts` |
| Phone Hunter (8 methods + cross-validation) | `src/lib/engines/phone-hunter.ts` |
| Exterior text mining (OCR mailbox/permit/plaque) | `src/lib/engines/exterior-text-miner.ts` |
| Strict French contact validators | `src/lib/utils/contact-validator.ts` |
| Excel + CSV export | `src/app/api/export/*` |
| Retry-phone per lead | `src/app/api/leads/[id]/retry-phone` |
| Hidden Operator Detector (cluster by phone/domain/SIRET) | `src/lib/engines/operator-clusterer.ts` |

---

## Tier 1 — Compliance & safety foundation (BUILD FIRST)

Everything else depends on having a compliance spine. Without it, every "weird
signal" feature accumulates legal debt.

### 1.1 Suppression list 📋

**What** — User-scoped `suppression_list` table: emails/phones marked
do-not-contact, with reason and source.

**Why** — A single primitive prevents re-acquiring contacts the operator has
asked to be removed; required by GDPR (Right to Object).

**Build**
- Schema: `suppression_list (id, user_id, kind: 'email'|'phone'|'domain'|'siret',
  value, reason, source, created_at)`
- Insert hook on every contact-extraction write path: skip if value is suppressed.
- Endpoints: `POST /api/suppression`, `DELETE /api/suppression/:id`,
  `GET /api/suppression`.
- UI: "Mark do-not-contact" button on `/leads/[id]` — pushes the email+phone to
  the list, then sets `outreach_status: "opted_out"`.

**Compliance** — Required. Treat as P0.

### 1.2 Compliance metadata per lead 📋

**What** — Per-record fields: `lawful_basis`, `data_category`, `source_url`,
`source_collected_at`, `retention_until`, `is_personal_data`, `consent_required`,
`processing_purpose`.

**Build** — Either as columns on `leads` or as a 1:1 `lead_compliance` table
(cleaner). Default `lawful_basis = 'legitimate_interest_b2b_prospecting'` for
SIRENE-derived auto-entrepreneur data, `retention_until = +12 months`.

**Compliance** — Required.

### 1.3 Audit trail 📋

**What** — Append-only log of every contact action (view, export, outreach,
mark contacted, delete). User-scoped, immutable for 24 months.

**Build** — `audit_log (id, user_id, lead_id, action, metadata jsonb, ip,
created_at)`. Service-role inserts from API routes.

**Compliance** — Required for DPO inquiries.

---

## Tier 2 — Operator-level intelligence (BIGGEST UPLIFT)

### 2.1 Hidden Operator Detector ✅

Already shipped. Surfaces multi-property operators by clustering on phone,
website domain, email domain, brand name, SIRET (when present).

**Next iteration**
- Add a "merge cluster" action: collapse the cluster into a single canonical
  Operator entity with cluster_id stored on each lead.
- Add SIRET column on `leads` (currently inside `geo_signals.operator`) so it
  can be a clustering key.
- Fuzzy name matching (Levenshtein ≤ 3 on normalised names) for low-confidence
  clusters needing human review.

### 2.2 Operator-centric outreach 📋

**What** — Instead of one outreach per listing, one outreach per Operator
cluster covering all their properties.

**Build** — When opening a clustered lead, the AI outreach writer should be
fed the entire cluster's evidence (cities, properties, signals).

**Why** — Conversion is 3-5× higher when you reference all of an operator's
properties; also halves outreach volume → friendlier to spam filters and ESPs.

### 2.3 SIRENE / Recherche Entreprises sync 📋

**What** — For each detected operator with a likely SIRET, pull the full SIRENE
record: legal form, NAF code, registration date, capital, registered address,
director name (when public on Pappers).

**Build** — Already partly there (`searchEntreprises`). Wrap with a
`syncOperator(siret)` method that backfills the cluster representative.

**Compliance** — SIRENE is open data (Etalab license). Lawful basis: legitimate
interest. Retention: 24 months. Record source = "data.gouv.fr/SIRENE".

---

## Tier 3 — Weird signal scanners (HIGH-SIGNAL, FUN)

For each signal: detection method + lawful source + lead-value hypothesis +
outreach insight.

### 3.1 Direct booking website auditor 📋

Public-page inspection (no auth, no scraping behind login, no DOS):

| Signal | Detector | Lead hypothesis | Outreach angle |
|---|---|---|---|
| Slow page (LCP >3s) | Lighthouse API on public URL | Losing 10-30% of bookings on mobile | "Your site is X seconds slow vs benchmark" |
| No structured data (JSON-LD missing) | Page parse | Invisible on Google for local searches | "Your site has 0 schema markup, here's what to add" |
| No booking engine on luxury page | Regex for Lodgify/Smoobu/Hostaway/etc on page HTML | Pays 15% OTA commission per booking | "Direct booking calculator — recover €X/year" |
| English-only in FR market | Page lang detect | Missing 60% of French-speaking guests | "Your French audience is bouncing" |
| Linktree in IG bio + no own site | Public Instagram preview (allowed by IG ToS for embeds) | Brand-aware but no SEO presence | "Why a website would outperform Linktree" |
| No HTTPS or expired cert | TLS handshake | Trust issue at checkout | "Visitors are seeing a warning on your site" |
| Copyright year 2-3 years stale | Footer regex | Probably abandoned or low investment | "Site looks unmaintained" |
| Photos with EXIF date >2y old | Image header parse | Operational signal: stale content | "Your photos are dated [Y]" |

**Build** — `src/lib/engines/website-auditor.ts` runs all detectors per public
URL, writes findings as `lead_signals` rows. New endpoint
`POST /api/leads/[id]/audit`.

**Compliance** — Only public pages, identified User-Agent (`ProspectBot/1.0`),
honor robots.txt, ≤5 requests/site/hour.

### 3.2 Multi-platform footprint 📋

**What** — Cross-reference an operator's primary URL against Booking, Vrbo,
Abritel, Gîtes de France, Clévacances using the existing reverse-image-search
results from the visual pipeline. Build a "platform presence matrix".

**Build** — Already in `geo-reconstruction Step 2`. Surface it on the operator
dossier.

### 3.3 Demand spike detector 📋

**What** — Detect when an operator's city has a demand spike (event, festival,
school holiday) and their listing shows operational gaps (static pricing,
no minimum stay, no event landing page).

**Sources**
- France public events: `data.gouv.fr` + `OpenAgenda` (open data).
- School holidays: `education.gouv.fr` open dataset.
- Flight/train route announcements: SNCF open data.
- Trends: Google Trends API (allowed, B2B use).

**Build** — `src/lib/engines/demand-detector.ts`. Cron job runs weekly and
emits a `weekly_demand_signals` per city → cross-references against active
operators.

**Outreach** — *"Major festival in your city next month, here are the pricing
tactics top operators use"* — referral-style, not invasive.

### 3.4 Review intelligence (lawful subset only) 📋

**What** — Use ONLY platforms that publish review feeds via official APIs
(Booking partner API, Google Place Reviews API, Tripadvisor official feed).
NEVER scrape user-generated content directly from Airbnb pages.

**Detect** — Repeated complaints (cleaning, wifi, check-in), praise themes,
operator response tone, missing amenities.

**Build** — Behind a partner-API flag. Skip in MVP unless we have partner
credentials.

**Compliance** — Reviews mention third parties (guests). Strip names before
analysis, do not store guest identifiers.

---

## Tier 4 — Inbound intent tools (NO SCRAPING NEEDED)

Build small public-facing tools that owners voluntarily use. Each yields a
**consent-based** lead with explicit lawful basis.

### 4.1 Free audit tools 📋

| Tool | Input | Output | Lead capture |
|---|---|---|---|
| Direct booking potential | Listing URL | "You leak €X/year in OTA fees" | Email + opt-in for full report |
| Photo quality grader | Listing URL | 0-100 score on lighting/angles/staging | Email for tip sheet |
| Amenity gap analyzer | Listing URL | "Top operators in your area have X, you don't" | Email for benchmark |
| Pricing event calendar | City | Next 12 months of demand events | Email for monthly digest |
| Listing SEO grader | Direct booking URL | Lighthouse-style audit | Email for remediation plan |

**Build** — One new page per tool under `/tools/*`. Each form requires explicit
consent checkbox; saves to `consent_logs` table; passes the consent ID into the
lead record's `lawful_basis_id`.

**Compliance gold standard** — These are the easiest leads to outreach to
because they granted consent. Treat them as Tier-A.

### 4.2 Public partner registration 📋

**What** — A `/partners` page where photographers, cleaners, smart-lock
installers, etc. can submit their service. Becomes the seed of the Partner
Network Mapper.

**Why** — Reverse-concierge strategy. A cleaner serving 50 luxury villas is
worth 10× a cold-email pitch.

---

## Tier 5 — Public signal aggregator (LARGEST DATA LIFT)

### 5.1 Open-data ingestion workers 📋

A `src/lib/ingest/` directory with one worker per source:

| Source | What it surfaces | License |
|---|---|---|
| `data.gouv.fr/sirene` | Auto-entrepreneurs with NAF 5520Z/6820A | Open (Etalab 2.0) |
| `data.gouv.fr/dvf` | Property transactions (parcel, price, type) | Open (Etalab 2.0) |
| `data.gouv.fr/sit@del2` | Building permits (applicant name, address) | Open (Etalab 2.0) |
| `apicarto.ign.fr` | Cadastral parcels | Open (free API) |
| `atout-france.fr` | Classified meublés de tourisme registry | Public registry |
| INSEE | Commune statistics, population, tourism intensity | Open |
| Local tourism offices | Member directories (where published) | Per-OT terms |

**Build** — Each worker is a cron Vercel function: `vercel.json` schedule,
30-min runtime. Writes raw rows to `ingest_<source>` staging tables.
Normalisation pass downstream resolves them into `entities`, `properties`,
`websites`, `signals`.

**Compliance** — All sources are public open-data with explicit licenses.
Record license per row.

### 5.2 Entity resolution service 📋

**What** — A worker that runs after each ingestion, merging new rows with
existing leads and operator clusters via the same `operator-clusterer` logic.

**Build** — Background job, queue-based. Acceptance: a SIRENE row arriving
with the same SIRET as an existing operator updates the operator's record;
a DVF row at the same cadastral parcel as a visual-reconstruction lead boosts
that lead's `reconstruction_confidence`.

---

## Tier 6 — Dashboards & dossiers

### 6.1 Lead dossier generator 📋

Per-lead one-page dossier rendered as HTML and exportable to PDF. Sections:

1. Summary (operator name, score, type, locations).
2. Evidence trail (where each piece of data came from).
3. Opportunity score breakdown (geo, image-match, entity, audit, signals).
4. Weird signals found (from Tier 3 scanners).
5. Cluster membership (related listings under the same operator).
6. Public web presence (websites, social, OTAs).
7. Suggested service fit (rule-based + Mammouth recommendation).
8. Best contact path + lawful basis.
9. Compliance notes (sources, retention, opt-out status).
10. Outreach drafts (3 variants: email, LinkedIn, postal).
11. Recommended next action.

**Build** — One Mammouth call per dossier with structured context. Cache.
Stream to PDF via `@vercel/og` for thumbnail + a print stylesheet.

### 6.2 Prioritisation dashboard 📋

`/dashboard` with sortable lists:
- Top operators by lead count (cluster size).
- Best under-optimised websites (audit score < 50, opportunity > 70).
- Fastest-growing concierges (new leads detected last 30d).
- Best partner intro routes (cleaners/photographers near top operators).
- Highest revenue upside (Mammouth-estimated).
- Leads requiring human review (low compliance safety score).

---

## Tier 7 — Outreach & relationship management

### 7.1 Evidence-based outreach generator 🚧

Partially shipped (`/api/leads/[id]/outreach`). Extend with:
- Strict no-creepy templates: never reveal which open-data source we used.
- 5 channel variants: email, LinkedIn DM, contact form, postal letter, partner
  intro.
- Built-in opt-out language.
- Frequency cap: max 1 outreach per lead per 90 days.

### 7.2 Outreach frequency cap 📋

**What** — Per-lead `last_contacted_at`; outreach endpoints refuse if <90 days.
Per-domain rate limit: max 5 outreach actions per domain per week.

### 7.3 Human review queue 📋

**What** — A `/review` queue showing low-confidence leads (any of:
`reconstruction_confidence < 40`, `compliance_risk: 'high'`, fuzzy-only
cluster). Reviewer approves/rejects/merges before the lead becomes contactable.

---

## Data model (target — does not destroy current schema)

The current schema (`leads`, `lead_sources`, `lead_signals`, `lead_enrichment_events`,
`search_runs`, `search_run_logs`) is preserved as-is. New tables are
**additive**:

```sql
-- Compliance spine
suppression_list (id, user_id, kind, value, reason, source, created_at)
consent_logs    (id, user_id, lead_id, basis, source_form, ip, created_at)
audit_log       (id, user_id, lead_id, action, metadata, ip, created_at)
lead_compliance (lead_id PK, lawful_basis, data_category, source_url,
                 source_collected_at, retention_until, is_personal_data,
                 consent_required, opt_out_status, processing_purpose)

-- Operator graph
operators       (id, user_id, canonical_name, siret, primary_phone, primary_domain,
                 representative_lead_id, lead_count, confidence, evidence jsonb)
operator_leads  (operator_id, lead_id, joined_at)

-- Ingestion staging
ingest_sirene   (raw_json, ingested_at, processed_at, source_license)
ingest_dvf      (raw_json, ingested_at, processed_at, source_license)
ingest_sitadel  (raw_json, ingested_at, processed_at, source_license)

-- Audit findings
website_audits  (id, lead_id, run_at, score, findings jsonb, lighthouse jsonb)
demand_events   (id, city, kind, source, start_date, end_date, metadata jsonb)

-- Partners & ecosystem
partners        (id, kind, name, city, website, phone, email, consent_id)
partner_links   (operator_id, partner_id, relationship, confidence, evidence)

-- Tasks / human review
review_tasks    (id, lead_id, reason, status, assignee_id, notes, created_at)
```

Retention defaults:
- Marketing-suitable leads (B2B legitimate interest): 12 months from last
  positive interaction.
- Suppression list entries: indefinite (required for compliance).
- Audit logs: 24 months minimum.
- Ingestion staging: 90 days, then archived.

---

## Service architecture

```
                    ┌────────────────┐
                    │  Next.js app   │
                    │   API routes   │
                    └───────┬────────┘
                            │
            ┌───────────────┼────────────────┐
            ▼               ▼                ▼
      ┌──────────┐    ┌──────────┐    ┌────────────┐
      │  Engines │    │ Service  │    │ Compliance │
      │  (sync)  │    │ workers  │    │   gate     │
      │          │    │  (cron)  │    │            │
      │ orchestr │    │ ingest   │    │ suppress.  │
      │ visual   │    │ audit    │    │ consent    │
      │ maps     │    │ demand   │    │ audit log  │
      │ phone    │    │ ER merge │    │            │
      │ cluster  │    │ outreach │    │            │
      └────┬─────┘    └────┬─────┘    └────┬───────┘
           │               │                │
           └───────────────┴────────────────┘
                           │
                  ┌────────▼─────────┐
                  │     Supabase     │
                  │  Postgres + RLS  │
                  └──────────────────┘
```

**Stack additions to consider** (not required for MVP)
- Vercel Cron for the ingestion workers.
- A queue (Upstash QStash or Vercel Queues) for entity resolution backpressure.
- `pgvector` for semantic deduplication in entity resolution.
- A graph view (D3/Cytoscape) over the `operators` + `partner_links` tables.

---

## Implementation plan

### Sprint 1 (week 1–2) — Compliance spine + operator merge

| Day | Task |
|---|---|
| 1 | Schema: `suppression_list`, `audit_log`, `lead_compliance` |
| 2 | Suppression endpoints + write-path hooks |
| 3 | Audit log middleware on all mutation routes |
| 4 | "Mark do-not-contact" UI on `/leads/[id]` |
| 5 | Operator merge action on `/operators` page |
| 6 | Cluster ID stored on each lead, displayed as badge in `/leads` table |
| 7 | Migration: backfill `lawful_basis` for existing leads |
| 8-10 | QA + Excel export now includes compliance columns |

**Definition of done** — Cannot create a lead whose contact is on the
suppression list. Every list view shows cluster size when applicable.

### Sprint 2 (week 3–4) — Website auditor + dossier

- `src/lib/engines/website-auditor.ts` with 6 detectors.
- `/api/leads/[id]/audit` endpoint.
- Lead detail page shows audit findings as a card.
- One-page HTML dossier at `/leads/[id]/dossier`, PDF export.

### Sprint 3 (week 5–6) — Inbound tools

- `/tools/direct-booking-calculator` — public, opt-in form.
- `/tools/photo-grader` — public, opt-in.
- Consent logs wired to lead creation.
- Owner of an audit becomes a Tier-A lead (highest priority queue).

### V2 (month 2–3) — Ingestion + entity resolution

- SIRENE worker (cron weekly, NAF 5520Z + 6820A new registrations).
- DVF worker (quarterly).
- Sit@del2 worker (monthly).
- Entity resolution service merges new ingested rows with existing leads.

### "Crazy but legal" experiments (run any time)

1. Aerial-photo pool-shape matching: cross-reference exterior visual signature
   with public Google Earth imagery to disambiguate ambiguous parcels.
2. Atout France classification plaque OCR — already happens in
   `exterior-text-miner`; add a registry lookup endpoint.
3. Construction permit panneau OCR (already extracts beneficiary) + Sit@del2
   confirmation → "verified owner" badge.
4. Photographer-style fingerprint: same EXIF camera/lens + city → same
   photographer → reach via the photographer.
5. Smart-lock installer geocoded service area → which villas in this area
   probably have keyless entry → high-end target list.

---

## Acceptance criteria (per feature)

- [ ] Real API call, no mocks.
- [ ] Source URL + collection timestamp recorded.
- [ ] Lawful basis assigned.
- [ ] Suppression list checked before write.
- [ ] Strict French validators applied to extracted contacts.
- [ ] `npm run build` passes with zero TS errors.
- [ ] At least one test case per detector.
- [ ] Honest empty state when no data is found.

---

## Scoring formulas (proposed)

```
LeadQualityScore =
    0.25 × OperatorQuality           (cluster size, professionalisation)
  + 0.20 × ContactQuality            (phone validated, email valid, multiple paths)
  + 0.15 × OpportunityScore          (audit gaps, weird signals)
  + 0.15 × LocationScore             (city desirability, demand seasonality)
  + 0.10 × ExclusivityScore          (no website + valid phone = hard-to-reach)
  + 0.10 × IntentScore               (consented inbound > observed signal)
  + 0.05 × EvidenceQuality           (number of independent sources)

ConfidenceScore = avg(per-signal confidence weighted by source reliability)

ComplianceSafetyScore =
   100 baseline
  − 30 if contact missing source URL
  − 25 if no lawful basis recorded
  − 20 if suppression list not checked at insert time
  − 15 if retention date in the past
  − 10 if data is personal but is_personal_data flag is false
```

---

## What ships TODAY (this commit)

1. ✅ Hidden Operator Detector engine
2. ✅ `GET /api/clusters` endpoint
3. ✅ `/operators` page with expandable cluster list
4. ✅ Nav link added
5. ✅ This roadmap doc

Everything else above is **specced and prioritised, not built**. The next
sprint should focus on Tier-1 (compliance spine) before any more discovery
features land — that's the line between a useful tool and a legal liability.

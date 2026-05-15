-- Migration 001 — Search cache + Suppression list + Compliance records
--
-- Apply this in the Supabase SQL editor when you want:
--   1. Persistent search cache (survives Vercel cold starts)
--   2. Proper suppression / Do-Not-Contact list keyed by email/phone, not lead
--   3. Per-record compliance audit trail with lawful_basis + retention dates
--
-- The codebase runs WITHOUT these tables — it degrades to in-memory cache,
-- per-lead DNC via outreach_status, and lead_enrichment_events for the audit
-- trail. Applying this migration upgrades all three pathways.

-- ── 1. search_cache ────────────────────────────────────────────────────────
-- Drop-in upgrade for src/lib/cache/search-cache.ts. After applying this,
-- swap that module to write/read here instead of the in-memory Map.

create table if not exists search_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
create index if not exists search_cache_expires_idx on search_cache (expires_at);
-- Allow service role only — never expose to client SDK.

-- ── 2. lead_suppression ────────────────────────────────────────────────────
-- Email/phone-keyed DNC list, scoped per user. Honoured at write time by
-- every contact-extraction path. Once a row is here, future scrapes
-- silently skip saving that contact even if a new lead surfaces it.

create table if not exists lead_suppression (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  contact_kind text not null check (contact_kind in ('email', 'phone')),
  contact_value text not null,
  reason text,
  source text,                            -- 'manual_user_action' | 'email_unsubscribe' | 'gdpr_request'
  created_at timestamptz default now()
);
create unique index if not exists lead_suppression_user_value_idx
  on lead_suppression (user_id, contact_kind, contact_value);
create index if not exists lead_suppression_user_idx on lead_suppression (user_id);

-- Row-level security: each user sees only their own suppression entries.
alter table lead_suppression enable row level security;
create policy "users see only own suppressions"
  on lead_suppression for select
  using (auth.uid() = user_id);
create policy "users insert own suppressions"
  on lead_suppression for insert
  with check (auth.uid() = user_id);

-- ── 3. lead_compliance_records ─────────────────────────────────────────────
-- Per-lead-per-data-point compliance audit. One row per (lead_id, data_kind)
-- with the lawful_basis hypothesis, retention date, processing purpose.
-- The compliance helper writes here at lead-save time.

create table if not exists lead_compliance_records (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  data_kind text not null,                -- 'email' | 'phone' | 'address' | 'visual_recon' | 'website'
  source_url text,
  collected_at timestamptz default now(),
  lawful_basis text not null,             -- text hypothesis under GDPR Art. 6(1)
  retention_until timestamptz not null,
  is_personal_data boolean default true,
  consent_required boolean default false,
  consent_obtained boolean default false,
  consent_obtained_at timestamptz,
  opt_out_status text default 'none',     -- 'none' | 'requested' | 'completed'
  processing_purpose text                 -- 'b2b_prospecting' | 'visual_analysis' | etc.
);
create index if not exists lead_compliance_records_lead_idx on lead_compliance_records (lead_id);

-- ── 4. graph_relationships ─────────────────────────────────────────────────
-- Optional: persist the entity-graph edges so we don't recompute them on every
-- read. The /api/leads/[id]/relationships endpoint computes on-the-fly today;
-- with this table it can index for fast cross-portfolio queries.

create table if not exists graph_relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  from_lead_id uuid not null references leads(id) on delete cascade,
  to_lead_id uuid not null references leads(id) on delete cascade,
  kind text not null,
  confidence text not null,
  evidence text,
  created_at timestamptz default now()
);
create index if not exists graph_relationships_from_idx on graph_relationships (from_lead_id);
create index if not exists graph_relationships_user_idx on graph_relationships (user_id);
create unique index if not exists graph_relationships_unique_edge
  on graph_relationships (from_lead_id, to_lead_id, kind);

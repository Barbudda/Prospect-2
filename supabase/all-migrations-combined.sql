-- Prospect Airbnb Leads V1 — Initial Schema
-- Run this migration in your Supabase SQL editor or via supabase db push

-- ─────────────────────────────────────────────
-- CLEAN SLATE (drop everything in reverse order)
-- ─────────────────────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

drop table if exists exports cascade;
drop table if exists provider_settings cascade;
drop table if exists lead_enrichment_events cascade;
drop table if exists lead_signals cascade;
drop table if exists lead_contacts cascade;
drop table if exists lead_sources cascade;
drop table if exists leads cascade;
drop table if exists raw_sources cascade;
drop table if exists search_run_logs cascade;
drop table if exists search_runs cascade;
drop table if exists profiles cascade;

-- ─────────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────────
create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text,
  full_name  text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "profiles_own" on profiles for all using (auth.uid() = id);

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─────────────────────────────────────────────
-- SEARCH RUNS
-- ─────────────────────────────────────────────
create table search_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  name             text,
  target_type      text,
  city             text not null,
  area             text,
  country          text not null,
  language         text,
  requested_leads  integer,
  status           text not null default 'queued',
  progress         integer default 0,
  started_at       timestamptz,
  finished_at      timestamptz,
  error_message    text,
  config_json      jsonb,
  stats_json       jsonb,
  created_at       timestamptz default now()
);

alter table search_runs enable row level security;
create policy "runs_own" on search_runs for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- SEARCH RUN LOGS
-- ─────────────────────────────────────────────
create table search_run_logs (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references search_runs on delete cascade,
  level         text,
  message       text not null,
  metadata_json jsonb,
  created_at    timestamptz default now()
);

alter table search_run_logs enable row level security;
create policy "logs_own" on search_run_logs for all
  using (exists (
    select 1 from search_runs sr
    where sr.id = search_run_logs.run_id
      and sr.user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- RAW SOURCES
-- ─────────────────────────────────────────────
create table raw_sources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  run_id      uuid references search_runs on delete cascade,
  provider    text not null,
  source_type text,
  source_url  text not null,
  query       text,
  title       text,
  snippet     text,
  raw_payload jsonb,
  fetched_at  timestamptz default now()
);

alter table raw_sources enable row level security;
create policy "raw_sources_own" on raw_sources for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- LEADS
-- ─────────────────────────────────────────────
create table leads (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  primary_name      text,
  company_name      text,
  person_name       text,
  lead_type         text,
  city              text,
  country           text,
  address           text,
  website_url       text,
  domain            text,
  email             text,
  phone             text,
  whatsapp_url      text,
  instagram_url     text,
  linkedin_url      text,
  facebook_url      text,
  contact_form_url  text,
  google_maps_url   text,
  source_url        text not null,
  source_type       text,
  score             integer,
  score_label       text,
  confidence        text,
  status            text default 'new',
  outreach_status   text default 'not_contacted',
  suggested_angle   text,
  notes             text,
  quality_summary   text,
  run_id            uuid references search_runs on delete set null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  last_enriched_at  timestamptz
);

alter table leads enable row level security;
create policy "leads_own" on leads for all using (auth.uid() = user_id);

create index leads_user_id_idx on leads(user_id);
create index leads_run_id_idx  on leads(run_id);
create index leads_score_idx   on leads(score desc);
create index leads_domain_idx  on leads(domain);

-- ─────────────────────────────────────────────
-- LEAD SOURCES
-- ─────────────────────────────────────────────
create table lead_sources (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads on delete cascade,
  run_id        uuid references search_runs on delete set null,
  provider      text,
  source_url    text not null,
  source_type   text,
  title         text,
  snippet       text,
  evidence_text text,
  confidence    text,
  created_at    timestamptz default now()
);

alter table lead_sources enable row level security;
create policy "lead_sources_own" on lead_sources for all
  using (exists (
    select 1 from leads l
    where l.id = lead_sources.lead_id
      and l.user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- LEAD CONTACTS
-- ─────────────────────────────────────────────
create table lead_contacts (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid not null references leads on delete cascade,
  contact_type        text,
  value               text not null,
  normalized_value    text,
  source_url          text,
  provider            text,
  confidence          text,
  is_primary          boolean default false,
  verification_status text default 'unverified',
  created_at          timestamptz default now()
);

alter table lead_contacts enable row level security;
create policy "lead_contacts_own" on lead_contacts for all
  using (exists (
    select 1 from leads l
    where l.id = lead_contacts.lead_id
      and l.user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- LEAD SIGNALS
-- ─────────────────────────────────────────────
create table lead_signals (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads on delete cascade,
  signal_type  text,
  signal_value text,
  source_url   text,
  confidence   text,
  created_at   timestamptz default now()
);

alter table lead_signals enable row level security;
create policy "lead_signals_own" on lead_signals for all
  using (exists (
    select 1 from leads l
    where l.id = lead_signals.lead_id
      and l.user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- LEAD ENRICHMENT EVENTS
-- ─────────────────────────────────────────────
create table lead_enrichment_events (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads on delete cascade,
  provider      text not null,
  status        text,
  input_json    jsonb,
  output_json   jsonb,
  error_message text,
  created_at    timestamptz default now()
);

alter table lead_enrichment_events enable row level security;
create policy "enrichment_events_own" on lead_enrichment_events for all
  using (exists (
    select 1 from leads l
    where l.id = lead_enrichment_events.lead_id
      and l.user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- PROVIDER SETTINGS
-- ─────────────────────────────────────────────
create table provider_settings (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users on delete cascade,
  provider_name         text not null,
  provider_type         text,
  is_enabled            boolean default false,
  encrypted_api_key_ref text,
  config_json           jsonb,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (user_id, provider_name)
);

alter table provider_settings enable row level security;
create policy "provider_settings_own" on provider_settings for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- EXPORTS
-- ─────────────────────────────────────────────
create table exports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  run_id      uuid references search_runs on delete set null,
  export_type text,
  status      text default 'pending',
  file_url    text,
  created_at  timestamptz default now()
);

alter table exports enable row level security;
create policy "exports_own" on exports for all using (auth.uid() = user_id);
-- Migration 002: add outreach AI columns to leads
alter table leads add column if not exists website_content text;
alter table leads add column if not exists outreach_email text;
alter table leads add column if not exists outreach_generated_at timestamptz;
-- Migration 003: performance indexes for leads table
-- The .neq("status", "draft") filter is used on every leads query
-- without an index, this is a full table scan.

create index if not exists leads_status_idx
  on leads(status);

create index if not exists leads_user_status_idx
  on leads(user_id, status);

-- Composite index for the common case: user's non-draft leads sorted by score
create index if not exists leads_user_score_idx
  on leads(user_id, score desc)
  where status != 'draft';
-- Migration 004: intelligence layer — all columns nullable, zero impact on existing leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS opportunity_score    integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS scale_score         integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intent_score        integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_property_count integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_team            boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cities_detected     text[];
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_faq             boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_booking_engine  boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_chatbot         boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS automation_level    text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_owner_acquisition_page boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_owner_cta       boolean;
-- 005: Lead Reconstruction Layer
-- Multi-platform detection, image matching, and reconstruction scoring

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS reconstruction_confidence INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS exclusivity_score          INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reconstructed              BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS multi_platform             BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS platform_count             INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS platforms_found            TEXT[]  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS image_matches              JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duplicate_sources          JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS geo_signals                JSONB   DEFAULT NULL;
-- 006: Individual Host fields
-- Superhost status and review count for small-operator leads

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS superhost      BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS review_count   INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS listing_title  TEXT    DEFAULT NULL;
-- Migration 007 — Suppression list (compliance Tier 1.1)
--
-- A per-user do-not-contact registry keyed on the contact value itself
-- (email or phone in E.164), so that a contact opted out on one lead is
-- automatically excluded from every future ingestion path. Setting
-- `outreach_status: opted_out` on a single lead does NOT achieve this —
-- the orchestrator + maps-prospect + visual-prospect + partners/discover
-- could all re-acquire the same email/phone from a different source.
--
-- The check is enforced at write time by helpers in
-- `src/lib/utils/suppression.ts`. RLS keeps each user's list private.

create table if not exists suppression_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('email', 'phone', 'domain')),
  -- Normalised value: emails are lowercased, phones are E.164.
  value text not null,
  reason text,
  source text, -- 'manual', 'bulk-dnc', 'unsubscribe', 'gdpr-request', ...
  source_lead_id uuid references leads(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A user can't list the same contact twice with the same kind.
  unique (user_id, kind, value)
);

create index if not exists suppression_list_user_kind_value_idx
  on suppression_list (user_id, kind, value);

alter table suppression_list enable row level security;

drop policy if exists "user can read own suppressions" on suppression_list;
create policy "user can read own suppressions"
  on suppression_list for select
  using (auth.uid() = user_id);

drop policy if exists "user can insert own suppressions" on suppression_list;
create policy "user can insert own suppressions"
  on suppression_list for insert
  with check (auth.uid() = user_id);

drop policy if exists "user can delete own suppressions" on suppression_list;
create policy "user can delete own suppressions"
  on suppression_list for delete
  using (auth.uid() = user_id);

-- The service role bypasses RLS and is used by orchestrator write-paths
-- to bulk-check / bulk-insert suppressions.
-- Migration 008 — Email campaigns + messages
--
-- Powers the /mailing feature. A `campaign` is a logical grouping of one
-- or more outgoing emails: the user picks a set of leads, optionally
-- chats with the RAG composer to draft a subject + body (per-lead or
-- shared template), and the executor sends each message via Resend.
--
-- `email_messages` is the per-recipient record — one row per email,
-- tracked through queued → sending → sent → delivered → opened → clicked
-- → bounced/complained. The Resend webhook updates these rows in place.
--
-- Suppression list (migration 007) and outreach frequency cap (90 days
-- per lead) are enforced before each row is created.

create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('rag_per_lead', 'general_template', 'manual')),
  subject_template text,
  body_template text,
  -- For per-lead RAG we cache the prompt the user gave the chatbot so we
  -- can regenerate / iterate later.
  rag_prompt text,
  from_email text,
  from_name text,
  reply_to text,
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  -- Aggregate counters maintained by the executor for fast list views.
  total_recipients integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_suppressed integer not null default 0,
  skipped_frequency_cap integer not null default 0
);

create index if not exists email_campaigns_user_created_idx
  on email_campaigns (user_id, created_at desc);

alter table email_campaigns enable row level security;

drop policy if exists "user can read own campaigns" on email_campaigns;
create policy "user can read own campaigns"
  on email_campaigns for select
  using (auth.uid() = user_id);

drop policy if exists "user can insert own campaigns" on email_campaigns;
create policy "user can insert own campaigns"
  on email_campaigns for insert
  with check (auth.uid() = user_id);

drop policy if exists "user can update own campaigns" on email_campaigns;
create policy "user can update own campaigns"
  on email_campaigns for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user can delete own campaigns" on email_campaigns;
create policy "user can delete own campaigns"
  on email_campaigns for delete
  using (auth.uid() = user_id);


create table if not exists email_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references email_campaigns(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  to_email text not null,
  to_name text,
  subject text not null,
  body text not null,
  -- Lifecycle:
  --   queued     — created, not yet handed to Resend
  --   sending    — Resend.send() in-flight
  --   sent       — Resend acknowledged with an id
  --   delivered  — webhook: email.delivered
  --   opened     — webhook: email.opened
  --   clicked    — webhook: email.clicked
  --   bounced    — webhook: email.bounced / hard bounce
  --   complained — webhook: email.complained (spam report)
  --   failed     — non-2xx from Resend at send time
  status text not null default 'queued' check (status in (
    'queued','sending','sent','delivered','opened','clicked','bounced','complained','failed'
  )),
  resend_id text,
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_messages_campaign_idx on email_messages (campaign_id);
create index if not exists email_messages_lead_idx on email_messages (lead_id);
create index if not exists email_messages_user_created_idx on email_messages (user_id, created_at desc);
create index if not exists email_messages_resend_id_idx on email_messages (resend_id) where resend_id is not null;

alter table email_messages enable row level security;

drop policy if exists "user can read own messages" on email_messages;
create policy "user can read own messages"
  on email_messages for select
  using (auth.uid() = user_id);

drop policy if exists "user can insert own messages" on email_messages;
create policy "user can insert own messages"
  on email_messages for insert
  with check (auth.uid() = user_id);

drop policy if exists "user can update own messages" on email_messages;
create policy "user can update own messages"
  on email_messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- Migration 009 — Fix "Database error saving new user" on signup
--
-- Cause: the original handle_new_user() in migration 001 references
-- `profiles` unqualified. Recent Supabase Postgres versions enforce an
-- empty search_path inside `security definer` functions for safety, so
-- the bare table name fails to resolve, the function errors out, the
-- trigger aborts the row, and Supabase reports the opaque message
-- "Database error saving new user" with no further detail.
--
-- Fix: re-create the function with `set search_path = public, auth`
-- pinned at definition time AND schema-qualify every table reference.
-- Idempotent — running this on a healthy DB is a no-op.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
exception
  -- Swallow any unexpected error so a missing-column / constraint
  -- mismatch never blocks signup again. The auth row is still created;
  -- the profile is filled in lazily by the app on first request.
  when others then
    raise warning '[handle_new_user] profile insert failed: % %', sqlerrm, sqlstate;
    return new;
end;
$$;

-- Re-attach the trigger in case it was dropped by manual cleanup.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Prospect Airbnb Leads V1 — Initial Schema
-- Run this migration in your Supabase SQL editor or via supabase db push

-- ─────────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────────
create table if not exists profiles (
  id         uuid primary key references auth.users on delete cascade,
  user_id    uuid not null unique references auth.users on delete cascade,
  email      text,
  full_name  text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "profiles_own" on profiles for all using (auth.uid() = user_id);

-- auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, user_id, email)
  values (new.id, new.id, new.email)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─────────────────────────────────────────────
-- SEARCH RUNS
-- ─────────────────────────────────────────────
create table if not exists search_runs (
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
create table if not exists search_run_logs (
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
    select 1 from search_runs where id = run_id and user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- RAW SOURCES
-- ─────────────────────────────────────────────
create table if not exists raw_sources (
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
create table if not exists leads (
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

-- index for fast filtering
create index if not exists leads_user_id_idx on leads(user_id);
create index if not exists leads_run_id_idx on leads(run_id);
create index if not exists leads_score_idx on leads(score desc);
create index if not exists leads_domain_idx on leads(domain);

-- ─────────────────────────────────────────────
-- LEAD SOURCES
-- ─────────────────────────────────────────────
create table if not exists lead_sources (
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
    select 1 from leads where id = lead_id and user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- LEAD CONTACTS
-- ─────────────────────────────────────────────
create table if not exists lead_contacts (
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
    select 1 from leads where id = lead_id and user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- LEAD SIGNALS
-- ─────────────────────────────────────────────
create table if not exists lead_signals (
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
    select 1 from leads where id = lead_id and user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- LEAD ENRICHMENT EVENTS
-- ─────────────────────────────────────────────
create table if not exists lead_enrichment_events (
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
    select 1 from leads where id = lead_id and user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- PROVIDER SETTINGS
-- ─────────────────────────────────────────────
create table if not exists provider_settings (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users on delete cascade,
  provider_name         text not null,
  provider_type         text,
  is_enabled            boolean default false,
  encrypted_api_key_ref text,
  config_json           jsonb,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique(user_id, provider_name)
);

alter table provider_settings enable row level security;
create policy "provider_settings_own" on provider_settings for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- EXPORTS
-- ─────────────────────────────────────────────
create table if not exists exports (
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

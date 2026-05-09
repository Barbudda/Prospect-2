import { NextResponse } from "next/server";
import { Client } from "pg";

export const dynamic = "force-dynamic";

// Migration 001 — full initial schema (idempotent: drops everything first)
const SQL_001 = `
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
`;

// Migration 002 — outreach columns (safe to re-run)
const SQL_002 = `
alter table leads add column if not exists website_content text;
alter table leads add column if not exists outreach_email text;
alter table leads add column if not exists outreach_generated_at timestamptz;
`;

// Migration 003 — performance indexes (safe to re-run)
const SQL_003 = `
create index if not exists leads_status_idx on leads(status);
create index if not exists leads_user_status_idx on leads(user_id, status);
create index if not exists leads_user_score_idx on leads(user_id, score desc) where status != 'draft';
`;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== "Bearer migrate-phgkubwavifzpmborcpx") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    return NextResponse.json({ error: "POSTGRES_URL_NON_POOLING not set" }, { status: 500 });
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  const results: string[] = [];

  try {
    await client.connect();

    await client.query(SQL_001);
    results.push("001_initial_schema: OK");

    await client.query(SQL_002);
    results.push("002_outreach_columns: OK");

    await client.query(SQL_003);
    results.push("003_leads_status_index: OK");

    // Verify the key table exists
    const check = await client.query(
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'search_runs'"
    );
    const tableExists = check.rows[0].count === "1";
    results.push(`search_runs table exists: ${tableExists}`);

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ error: String(e), results }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}

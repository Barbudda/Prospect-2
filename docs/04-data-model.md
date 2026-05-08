# Data Model

## search_runs
```
id               uuid primary key
user_id          uuid references auth.users
name             text
city             text not null
country          text not null
target_type      text default 'all'
requested_leads  integer default 50
status           text default 'queued'
  -- queued | running | collecting_sources | extracting_contacts
  -- enriching | deduplicating | scoring | completed | failed | cancelled
progress         integer default 0
started_at       timestamptz
finished_at      timestamptz
error_message    text
config_json      jsonb
stats_json       jsonb
created_at       timestamptz default now()
```

## leads
```
id                uuid primary key
run_id            uuid references search_runs
user_id           uuid references auth.users
primary_name      text
company_name      text
person_name       text
lead_type         text
  -- Airbnb Concierge | Property Manager | Vacation Rental Agency
  -- Direct Booking Owner | Gîte / Villa Operator | Co-host / Consultant
  -- Real Estate Seasonal Rental | Unknown STR Lead
city              text
country           text
address           text
website_url       text
domain            text
email             text
phone             text
whatsapp_url      text
instagram_url     text
linkedin_url      text
facebook_url      text
contact_form_url  text
google_maps_url   text
source_url        text not null
source_type       text
score             integer default 0
score_label       text    -- Hot (80-100) | Good (60-79) | Medium (40-59) | Weak (0-39)
confidence        text    -- high | medium | low
status            text default 'new'
outreach_status   text default 'not_contacted'
  -- not_contacted | contacted | replied | not_interested | converted | unsubscribed | opted_out
suggested_angle   text
notes             text
quality_summary   text
created_at        timestamptz default now()
updated_at        timestamptz default now()
```

## search_run_logs
```
id            uuid primary key
run_id        uuid references search_runs
level         text    -- info | warn | error | debug
message       text not null
metadata_json jsonb
created_at    timestamptz default now()
```

## lead_sources
```
id            uuid primary key
lead_id       uuid references leads on delete cascade
run_id        uuid references search_runs
provider      text
source_url    text not null
source_type   text
title         text
snippet       text
evidence_text text
confidence    text
created_at    timestamptz default now()
```

## lead_signals
```
id           uuid primary key
lead_id      uuid references leads on delete cascade
signal_type  text
signal_value text
source_url   text
confidence   text
created_at   timestamptz default now()
```

## lead_enrichment_events
```
id            uuid primary key
lead_id       uuid references leads on delete cascade
provider      text not null
status        text
input_json    jsonb
output_json   jsonb
error_message text
created_at    timestamptz default now()
```

## RLS policies
All tables: `USING (auth.uid() = user_id)` or via join to leads/search_runs.
Users see only their own data. Service role bypasses RLS for orchestrator writes.

## Migration
Full schema: `supabase/migrations/001_initial_schema.sql`
Run in Supabase SQL Editor before first use.

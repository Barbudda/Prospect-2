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

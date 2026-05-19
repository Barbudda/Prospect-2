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

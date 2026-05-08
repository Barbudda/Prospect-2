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

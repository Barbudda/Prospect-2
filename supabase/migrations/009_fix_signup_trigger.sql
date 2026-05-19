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

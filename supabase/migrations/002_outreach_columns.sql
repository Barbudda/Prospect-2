-- Migration 002: add outreach AI columns to leads
alter table leads add column if not exists website_content text;
alter table leads add column if not exists outreach_email text;
alter table leads add column if not exists outreach_generated_at timestamptz;

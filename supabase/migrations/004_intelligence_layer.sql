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

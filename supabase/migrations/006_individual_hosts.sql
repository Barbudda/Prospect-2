-- 006: Individual Host fields
-- Superhost status and review count for small-operator leads

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS superhost      BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS review_count   INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS listing_title  TEXT    DEFAULT NULL;

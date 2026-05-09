-- 005: Lead Reconstruction Layer
-- Multi-platform detection, image matching, and reconstruction scoring

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS reconstruction_confidence INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS exclusivity_score          INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reconstructed              BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS multi_platform             BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS platform_count             INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS platforms_found            TEXT[]  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS image_matches              JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duplicate_sources          JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS geo_signals                JSONB   DEFAULT NULL;

-- Пълномощно numbers per МИР, from 501 (PR: designation template exact + per-МИР numbering).
-- Apply once per database; deploys do not run it:
--   pnpm exec wrangler d1 execute DB --remote --file sql/2026-10-19-designation-number-per-mir.sql
--   pnpm exec wrangler d1 execute DB --env production --remote --file sql/2026-10-19-designation-number-per-mir.sql
ALTER TABLE signups ADD COLUMN designation_mir TEXT;
-- Numbers issued before this change belong to the МИР of the section they were issued for.
UPDATE signups SET designation_mir = substr(published_section, 1, 2)
  WHERE designation_number IS NOT NULL AND designation_mir IS NULL AND length(COALESCE(published_section, '')) >= 2;
CREATE UNIQUE INDEX IF NOT EXISTS idx_signups_designation_mir_number
  ON signups(designation_mir, designation_number) WHERE designation_number IS NOT NULL;

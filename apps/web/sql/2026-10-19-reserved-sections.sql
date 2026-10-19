-- Reserved sections (taken_sections): block drafting/publishing our people on sections reserved by other orgs.
-- Same statements as RESERVED_SECTION_GUARDS in src/signup/reserved-sections-sql.ts (also run at runtime).
-- Apply:
--   pnpm exec wrangler d1 execute ti-broish-signup-staging --remote --file sql/2026-10-19-reserved-sections.sql
--   pnpm exec wrangler d1 execute ti-broish-signup --remote --file sql/2026-10-19-reserved-sections.sql
CREATE INDEX IF NOT EXISTS idx_taken_org ON taken_sections(organisation);
CREATE TRIGGER IF NOT EXISTS trg_signups_reserved_draft_update
BEFORE UPDATE OF draft_section ON signups
WHEN COALESCE(NEW.draft_section, '') != ''
  AND NEW.draft_section IS NOT OLD.draft_section
  AND NEW.draft_section IS NOT OLD.published_section
  AND EXISTS (SELECT 1 FROM taken_sections WHERE section_code = NEW.draft_section)
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END;
CREATE TRIGGER IF NOT EXISTS trg_signups_reserved_published_update
BEFORE UPDATE OF published_section ON signups
WHEN COALESCE(NEW.published_section, '') != ''
  AND NEW.published_section IS NOT OLD.published_section
  AND EXISTS (SELECT 1 FROM taken_sections WHERE section_code = NEW.published_section)
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END;
CREATE TRIGGER IF NOT EXISTS trg_signups_reserved_insert
BEFORE INSERT ON signups
WHEN EXISTS (SELECT 1 FROM taken_sections WHERE section_code IN (COALESCE(NEW.draft_section, ''), COALESCE(NEW.published_section, '')))
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END;

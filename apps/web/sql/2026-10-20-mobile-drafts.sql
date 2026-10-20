-- Mobile-team drafts: area + target priority sections per mobile person. Drafts only.
-- Same statements as src/signup/mobile-teams-sql.ts (also run at runtime in signupDatabase()).
-- Apply:
--   pnpm exec wrangler d1 execute ti-broish-signup-staging --remote --file sql/2026-10-20-mobile-drafts.sql
--   pnpm exec wrangler d1 execute ti-broish-signup --remote --file sql/2026-10-20-mobile-drafts.sql
CREATE TABLE IF NOT EXISTS mobile_drafts (
  signup_id TEXT PRIMARY KEY,
  team_key TEXT NOT NULL,
  mir_code TEXT NOT NULL,
  municipality_code TEXT NOT NULL,
  area_key TEXT NOT NULL,
  area_label TEXT NOT NULL,
  targets TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'auto',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mobile_drafts_mir ON mobile_drafts(mir_code);
CREATE INDEX IF NOT EXISTS idx_mobile_drafts_team ON mobile_drafts(team_key);
CREATE TRIGGER IF NOT EXISTS trg_mobile_drafts_reserved_insert
BEFORE INSERT ON mobile_drafts
WHEN EXISTS (SELECT 1 FROM json_each(NEW.targets) j JOIN taken_sections t ON t.section_code = json_extract(j.value, '$.code'))
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END;
CREATE TRIGGER IF NOT EXISTS trg_mobile_drafts_reserved_update
BEFORE UPDATE OF targets ON mobile_drafts
WHEN EXISTS (SELECT 1 FROM json_each(NEW.targets) j JOIN taken_sections t ON t.section_code = json_extract(j.value, '$.code'))
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END;

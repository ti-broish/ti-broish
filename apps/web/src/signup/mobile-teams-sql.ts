/**
 * Mobile-team drafts: one row per mobile person. The area (МИР + municipality, or a town /
 * city district) and the target priority sections as JSON [{code, r, level, town}].
 * A draft only: nothing here publishes, numbers, mails or syncs Brevo.
 */
export const MOBILE_DRAFTS_TABLE = `
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
)`

/** Reserved sections (taken_sections) can never be a mobile target, from any path. */
export const MOBILE_DRAFTS_GUARDS = [
  'CREATE INDEX IF NOT EXISTS idx_mobile_drafts_mir ON mobile_drafts(mir_code)',
  'CREATE INDEX IF NOT EXISTS idx_mobile_drafts_team ON mobile_drafts(team_key)',
  `CREATE TRIGGER IF NOT EXISTS trg_mobile_drafts_reserved_insert
BEFORE INSERT ON mobile_drafts
WHEN EXISTS (SELECT 1 FROM json_each(NEW.targets) j JOIN taken_sections t ON t.section_code = json_extract(j.value, '$.code'))
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_mobile_drafts_reserved_update
BEFORE UPDATE OF targets ON mobile_drafts
WHEN EXISTS (SELECT 1 FROM json_each(NEW.targets) j JOIN taken_sections t ON t.section_code = json_extract(j.value, '$.code'))
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END`,
]

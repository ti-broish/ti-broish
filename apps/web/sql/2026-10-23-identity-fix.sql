-- „Поправи име/ЕГН“ (/admin/rik tasks, person pages). Also created at runtime
-- (src/signup/identity-fix.ts ensureIdentityFixTables, src/signup/rik/sync.ts RIK_COLUMNS),
-- which skips columns that already exist; the ALTERs below fail harmlessly when run twice.
CREATE TABLE IF NOT EXISTS designation_file_history (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  mir TEXT NOT NULL DEFAULT '',
  number INTEGER,
  drive_file_id TEXT NOT NULL DEFAULT '',
  pdf_url TEXT NOT NULL DEFAULT '',
  signed_at TEXT,
  reason TEXT NOT NULL,
  superseded_at TEXT NOT NULL,
  superseded_by TEXT NOT NULL,
  replaced_by_file_id TEXT,
  replaced_by_url TEXT,
  replaced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_designation_file_history_person ON designation_file_history(person_id, superseded_at);
ALTER TABLE designation_renames ADD COLUMN old_egn TEXT NOT NULL DEFAULT '';
ALTER TABLE designation_renames ADD COLUMN origin TEXT NOT NULL DEFAULT '';
ALTER TABLE designation_renames ADD COLUMN task_id TEXT;
ALTER TABLE rik_tasks ADD COLUMN fixed_at TEXT;
ALTER TABLE rik_tasks ADD COLUMN fixed_by TEXT;

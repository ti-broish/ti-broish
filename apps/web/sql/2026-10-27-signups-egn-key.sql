-- Duplicate-ЕГН lookup for signups (src/signup/egn-in-use.ts). Also created at runtime
-- (src/signup/db-core.ts INDEXES). A plain index, not UNIQUE: existing rows may already share an ЕГН
-- and none is changed. Safe to run twice.
CREATE INDEX IF NOT EXISTS idx_signups_egn_key ON signups(REPLACE(TRIM(COALESCE(egn, '')), ' ', ''));

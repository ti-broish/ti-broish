-- „Публикувана секция → напред“ (src/signup/published-pipeline.ts): which published section a
-- volunteer's Brevo contact was last synced for (section@published_at) and when. Also added at
-- runtime (src/signup/db-core.ts, BREVO_SECTION_SYNC_COLUMNS). Nullable, no data is changed.
-- A second run fails with "duplicate column name": the columns are already there.
ALTER TABLE signups ADD COLUMN brevo_section_synced TEXT;
ALTER TABLE signups ADD COLUMN brevo_section_synced_at TEXT;

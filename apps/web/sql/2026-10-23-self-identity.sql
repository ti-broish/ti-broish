-- „Смяна име/ЕГН – нов документ“ (self-service change with a пълномощно). Also added at runtime
-- (src/signup/rik/sql.ts RIK_COLUMNS via ensureRikTables); the ALTERs fail harmlessly when run twice.
ALTER TABLE rik_tasks ADD COLUMN old_name TEXT;
ALTER TABLE rik_tasks ADD COLUMN old_egn TEXT;

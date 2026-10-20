-- Отписани → „Обработен“: an admin marks a withdrawn person as handled, and can undo it.
-- Both columns stay NULL until then; withdrawal_processed_by is the admin's email.
-- Also applied at runtime by db-core signupDatabase() (ADD_COLUMNS). Apply once per database:
--   pnpm exec wrangler d1 execute ti-broish-signup-staging --remote --file sql/2026-10-20-withdrawal-processed.sql
--   pnpm exec wrangler d1 execute ti-broish-signup --remote --file sql/2026-10-20-withdrawal-processed.sql
ALTER TABLE signups ADD COLUMN withdrawal_processed_at TEXT;
ALTER TABLE signups ADD COLUMN withdrawal_processed_by TEXT;

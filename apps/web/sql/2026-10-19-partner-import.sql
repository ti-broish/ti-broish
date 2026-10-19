-- Partner import („И аз“, iaz.bg): who came from a partner list and when they signed up there.
-- The worker also adds these columns on first use (db-core ADD_COLUMNS); run this once per database before the deploy:
--   pnpm exec wrangler d1 execute DB --remote --file sql/2026-10-19-partner-import.sql
--   pnpm exec wrangler d1 execute DB --env production --remote --file sql/2026-10-19-partner-import.sql
ALTER TABLE signups ADD COLUMN partner TEXT;
ALTER TABLE signups ADD COLUMN partner_submitted_at TEXT;
ALTER TABLE signups ADD COLUMN partner_imported_at TEXT;
CREATE INDEX IF NOT EXISTS idx_signups_partner ON signups(partner);

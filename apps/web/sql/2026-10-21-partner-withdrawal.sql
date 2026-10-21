-- „И аз“: withdraw one пълномощно, and mark a partner row covered by a volunteer (same ЕГН).
-- Additive only: four NULL columns on partner_people. Number and МИР stay on a withdrawn row.
-- Also applied at runtime by db-core signupDatabase() (PARTNER_WITHDRAWAL_COLUMNS). Run once per database, before the code ships:
--   cf d1 query <database-id> --sql "$(cat sql/2026-10-21-partner-withdrawal.sql)"
ALTER TABLE partner_people ADD COLUMN withdrawn_at TEXT;
ALTER TABLE partner_people ADD COLUMN withdrawn_by TEXT;
ALTER TABLE partner_people ADD COLUMN withdrawn_reason TEXT;
ALTER TABLE partner_people ADD COLUMN covered_by_signup_id TEXT;

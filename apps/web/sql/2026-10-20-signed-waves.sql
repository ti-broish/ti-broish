-- Waves of signed пълномощни (PR: РИК tables in the signed ZIPs).
-- Also applied at runtime by db-core signupDatabase(). Run once per database, before the code ships.
-- designation_first_signed_at is written by the first signed upload and kept on replacement;
-- the wave is its Sofia calendar day. Rows signed before this column keep their signed time.
ALTER TABLE signups ADD COLUMN designation_first_signed_at TEXT;
ALTER TABLE partner_people ADD COLUMN designation_first_signed_at TEXT;
UPDATE signups SET designation_first_signed_at = designation_signed_at WHERE designation_first_signed_at IS NULL AND designation_signed_at IS NOT NULL;
UPDATE partner_people SET designation_first_signed_at = designation_signed_at WHERE designation_first_signed_at IS NULL AND designation_signed_at IS NOT NULL;

-- Waves of пълномощни by the date printed in the PDF (PR: waves by PDF date + „Изпратена на РИК“).
-- Also applied at runtime by db-core signupDatabase(). Run once per database, before the code ships.
-- A wave is a date from the PDF (designation_issued_at), never the signed-upload day.
-- „Изпратена на РИК“ writes a signing_waves row and sets designation_wave_id on everyone numbered
-- with that date and no wave yet. Later numbers with the same date form the next wave.
CREATE TABLE IF NOT EXISTS signing_waves (
  id TEXT PRIMARY KEY,
  issue_date TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  closed_by TEXT NOT NULL DEFAULT ''
);
ALTER TABLE signups ADD COLUMN designation_wave_id TEXT;
ALTER TABLE partner_people ADD COLUMN designation_wave_id TEXT;

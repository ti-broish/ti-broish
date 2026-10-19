-- „И аз“ partner people: only for пълномощни, never signups, never Brevo.
-- Also created at runtime by signupDatabase() (db-core.ts).
CREATE TABLE IF NOT EXISTS partner_people (
  id TEXT PRIMARY KEY,
  partner TEXT NOT NULL,
  egn TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  middle_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  region_code TEXT NOT NULL DEFAULT '',
  region_name TEXT NOT NULL DEFAULT '',
  municipality_name TEXT NOT NULL DEFAULT '',
  place_note TEXT NOT NULL DEFAULT '',
  designation_mir TEXT,
  designation_number INTEGER,
  designation_issued_at TEXT,
  designation_generated_at TEXT,
  designation_signed_at TEXT,
  designation_pdf_url TEXT,
  designation_drive_file_id TEXT,
  submitted_at TEXT,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (partner, egn)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_people_mir_number ON partner_people(designation_mir, designation_number) WHERE designation_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partner_people_email ON partner_people(email);

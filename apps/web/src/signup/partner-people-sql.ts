/**
 * Partner people („И аз“): imported only to issue пълномощни. They live in their own
 * table, never in signups, so they are not signups, not counted, not assigned and
 * never reach Brevo. Also in sql/2026-10-19-partner-people.sql.
 */
export const PARTNER_PEOPLE_TABLE = `
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
)`

export const PARTNER_PEOPLE_INDEXES = [
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_people_mir_number ON partner_people(designation_mir, designation_number) WHERE designation_number IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_partner_people_email ON partner_people(email)',
]

/** Partner people ids carry this prefix, so a designation route knows which table to read. */
export const PARTNER_ID_PREFIX = 'pp-'

export function isPartnerPersonId(id: string) {
  return id.startsWith(PARTNER_ID_PREFIX)
}

/** Brevo paths only ever take signup ids; partner people are dropped before any Brevo call. */
export function brevoSignupIds(ids: string[]) {
  return ids.filter((id) => !isPartnerPersonId(id))
}

/**
 * A partner person shaped like a signup row for the пълномощно renderer: names in `payload`,
 * the МИР as `published_section` (the document names only the МИР), no section place.
 */
export const PARTNER_DESIGNATION_COLUMNS = `id,
  json_object('firstName', first_name, 'middleName', middle_name, 'lastName', last_name) AS payload,
  egn,
  COALESCE(designation_mir, '') AS published_section,
  '' AS section_place,
  designation_number, designation_issued_at`

export const PARTNER_DESIGNATION_ROW_SQL = `SELECT ${PARTNER_DESIGNATION_COLUMNS} FROM partner_people WHERE id = ?`

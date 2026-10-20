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

/**
 * Sections for partner people. A draft is only a plan; publishing sets section_published and
 * creates the „И аз“ reservation in taken_sections. Nothing here mails, numbers or syncs anyone.
 * Also in sql/2026-10-20-partner-sections.sql.
 */
export const PARTNER_RESERVATION_ORG = 'И аз'

export const PARTNER_SECTION_COLUMNS = [
  'ALTER TABLE partner_people ADD COLUMN section_draft TEXT',
  'ALTER TABLE partner_people ADD COLUMN section_draft_locked INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE partner_people ADD COLUMN section_draft_source TEXT',
  'ALTER TABLE partner_people ADD COLUMN section_drafted_at TEXT',
  'ALTER TABLE partner_people ADD COLUMN section_published TEXT',
  'ALTER TABLE partner_people ADD COLUMN section_published_at TEXT',
]

/** A code held by a live signup (draft or published). */
const SIGNUP_HOLDS = (code: string) =>
  `EXISTS (SELECT 1 FROM signups WHERE COALESCE(withdrawn, 0) = 0 AND (draft_section = ${code} OR published_section = ${code}))`
/** A code held by another partner person (draft or published). */
const OTHER_PARTNER_HOLDS = (code: string) =>
  `EXISTS (SELECT 1 FROM partner_people p WHERE p.id != NEW.id AND (p.section_draft = ${code} OR p.section_published = ${code}))`
/** A code that a mobile-team draft targets. */
const MOBILE_HOLDS = (code: string) =>
  `EXISTS (SELECT 1 FROM mobile_drafts m, json_each(m.targets) j WHERE json_extract(j.value, '$.code') = ${code})`

/**
 * One quota per section: a partner draft or published section may not sit on a section that a
 * signup, another partner person, a mobile target or a reservation already holds, and a signup
 * may not take a section a partner person holds. Signups get 'reserved_section' so every
 * existing signup path reports it as reserved (by „И аз“).
 */
export const PARTNER_SECTION_GUARDS = [
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_people_section_draft ON partner_people(section_draft) WHERE section_draft IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_people_section_published ON partner_people(section_published) WHERE section_published IS NOT NULL',
  `CREATE TRIGGER IF NOT EXISTS trg_partner_section_draft_update
BEFORE UPDATE OF section_draft ON partner_people
WHEN COALESCE(NEW.section_draft, '') != ''
  AND NEW.section_draft IS NOT OLD.section_draft
  AND NEW.section_draft IS NOT OLD.section_published
  AND (EXISTS (SELECT 1 FROM taken_sections WHERE section_code = NEW.section_draft)
    OR ${SIGNUP_HOLDS('NEW.section_draft')}
    OR ${OTHER_PARTNER_HOLDS('NEW.section_draft')}
    OR ${MOBILE_HOLDS('NEW.section_draft')})
BEGIN SELECT RAISE(ABORT, 'section_held'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_partner_section_published_update
BEFORE UPDATE OF section_published ON partner_people
WHEN COALESCE(NEW.section_published, '') != ''
  AND NEW.section_published IS NOT OLD.section_published
  AND (EXISTS (SELECT 1 FROM taken_sections WHERE section_code = NEW.section_published AND organisation != '${PARTNER_RESERVATION_ORG}')
    OR ${SIGNUP_HOLDS('NEW.section_published')}
    OR ${OTHER_PARTNER_HOLDS('NEW.section_published')}
    OR ${MOBILE_HOLDS('NEW.section_published')})
BEGIN SELECT RAISE(ABORT, 'section_held'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_partner_section_insert
BEFORE INSERT ON partner_people
WHEN COALESCE(NEW.section_draft, '') != '' OR COALESCE(NEW.section_published, '') != ''
BEGIN SELECT RAISE(ABORT, 'section_held'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_signups_partner_draft_update
BEFORE UPDATE OF draft_section ON signups
WHEN COALESCE(NEW.draft_section, '') != ''
  AND NEW.draft_section IS NOT OLD.draft_section
  AND NEW.draft_section IS NOT OLD.published_section
  AND EXISTS (SELECT 1 FROM partner_people WHERE section_draft = NEW.draft_section OR section_published = NEW.draft_section)
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_signups_partner_published_update
BEFORE UPDATE OF published_section ON signups
WHEN COALESCE(NEW.published_section, '') != ''
  AND NEW.published_section IS NOT OLD.published_section
  AND EXISTS (SELECT 1 FROM partner_people WHERE section_draft = NEW.published_section OR section_published = NEW.published_section)
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_signups_partner_insert
BEFORE INSERT ON signups
WHEN (COALESCE(NEW.draft_section, '') != '' OR COALESCE(NEW.published_section, '') != '')
  AND EXISTS (SELECT 1 FROM partner_people
    WHERE (COALESCE(section_draft, '') != '' AND section_draft IN (NEW.draft_section, NEW.published_section))
       OR (COALESCE(section_published, '') != '' AND section_published IN (NEW.draft_section, NEW.published_section)))
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END`,
]

export function isSectionHeldAbort(error: unknown) {
  return /section_held|UNIQUE constraint failed: partner_people\.section_/.test(error instanceof Error ? error.message : String(error))
}

/** Codes a partner person holds (draft or published). Empty before the columns exist. */
export const PARTNER_HELD_SQL = `SELECT section_draft AS code FROM partner_people WHERE COALESCE(section_draft, '') != ''
UNION SELECT section_published AS code FROM partner_people WHERE COALESCE(section_published, '') != ''`

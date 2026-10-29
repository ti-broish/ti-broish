/**
 * МИР follows the section, on every path. A volunteer or „И аз“ person who gets a section (draft or
 * published) through any route (Секции single/bulk, the allocator, „И аз“ panels, the person page,
 * imports, the API) gets the МИР the rest of the app reads, set by SQLite triggers, so no path can
 * forget it:
 *
 * - signups.mir_code (the home МИР the sectionless list, the roster and the allocator read) is
 *   filled from the section when it is empty (София без район, imports without a МИР, a profile
 *   save that recomputed it to nothing). A different home МИР is kept: the allocator pairs it with
 *   the home municipality, and a cross-МИР section must not rewrite where someone lives.
 * - partner_people.designation_mir (the МИР an „И аз“ пълномощно is numbered in) follows the
 *   person's own section (published, else draft); with no own section, the section (or numbered
 *   МИР) of the volunteer who covers them (covered_by_signup_id). Never once numbered: a number
 *   and its МИР stay (the #189 cross-МИР confirm still guards the numbering itself).
 *
 * Signups' designation_mir is never touched here: it only exists with a number.
 * Every change writes a signup_audit line (field 'mir', actor MIR_FROM_SECTION_ACTOR).
 * Triggers never touch updated_at, so optimistic updated_at checks on the same row keep working.
 * Also in sql/2026-10-29-mir-from-section.sql (bootstrap applies them too).
 */

export const MIR_FROM_SECTION_ACTOR = 'system (МИР от секцията)'
export const MIR_AUDIT_FIELD = 'mir'

/** МИР of a section code: its first two digits when it looks like a section (8+ characters). */
export function sectionMirSql(code: string) {
  const c = `TRIM(COALESCE(${code}, ''))`
  return `(CASE WHEN length(${c}) >= 8 AND substr(${c}, 1, 2) GLOB '[0-9][0-9]' THEN substr(${c}, 1, 2) ELSE '' END)`
}

/** Same rule in TS (tests, and to mirror the SQL). */
export function sectionMir(code: string | null | undefined) {
  const c = String(code ?? '').trim()
  return c.length >= 8 && /^\d\d/.test(c) ? c.slice(0, 2) : ''
}

/** A signup's section МИР: published wins over draft. */
export const signupSectionMirSql = (alias: string) =>
  `(CASE WHEN TRIM(COALESCE(${alias}.published_section, '')) != '' THEN ${sectionMirSql(`${alias}.published_section`)} ELSE ${sectionMirSql(`${alias}.draft_section`)} END)`

/** A partner's own section МИР: published wins over draft. */
export const partnerSectionMirSql = (alias: string) =>
  `(CASE WHEN TRIM(COALESCE(${alias}.section_published, '')) != '' THEN ${sectionMirSql(`${alias}.section_published`)} ELSE ${sectionMirSql(`${alias}.section_draft`)} END)`

/** The МИР a covering volunteer stands for: their number's МИР once numbered, else their section's. */
export const coveringSignupMirSql = (alias: string) =>
  `(CASE WHEN ${alias}.designation_number IS NOT NULL AND COALESCE(${alias}.designation_mir, '') != '' THEN ${alias}.designation_mir ELSE ${signupSectionMirSql(alias)} END)`

/** The МИР an unnumbered partner row should carry: own section first, else the covering volunteer's. */
export const partnerTargetMirSql = (alias: string) =>
  `COALESCE(NULLIF(${partnerSectionMirSql(alias)}, ''), (SELECT ${coveringSignupMirSql('cs')} FROM signups cs WHERE cs.id = ${alias}.covered_by_signup_id), '')`

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
const AUDIT_ID = 'lower(hex(randomblob(16)))'
const AUDIT_COLUMNS = 'INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at)'
const before = (value: string) => `COALESCE(NULLIF(${value}, ''), '—')`

/** Fill an empty signups.mir_code from the row's own section. */
const signupFill = (event: 'insert' | 'update') => {
  const target = signupSectionMirSql('NEW')
  const old = event === 'update' ? `COALESCE(OLD.mir_code, '')` : `''`
  return `CREATE TRIGGER IF NOT EXISTS trg_signups_mir_from_section_${event}
AFTER ${event === 'insert' ? 'INSERT' : 'UPDATE OF draft_section, published_section, mir_code'} ON signups
WHEN TRIM(COALESCE(NEW.mir_code, '')) = '' AND ${target} != ''
BEGIN
  ${AUDIT_COLUMNS}
  SELECT ${AUDIT_ID}, NEW.id, '${MIR_FROM_SECTION_ACTOR}', '${MIR_AUDIT_FIELD}', ${before(old)}, ${target}, ${NOW}
  WHERE ${old} != ${target};
  UPDATE signups SET mir_code = ${target} WHERE id = NEW.id;
END`
}

const partnerNeeds = (alias: string) =>
  `${alias}.designation_number IS NULL AND ${alias}.withdrawn_at IS NULL AND ${partnerTargetMirSql(alias)} != '' AND COALESCE(${alias}.designation_mir, '') != ${partnerTargetMirSql(alias)}`

/** An unnumbered partner row follows its own section, else its covering volunteer. */
const partnerFollow = (event: 'insert' | 'update') => `CREATE TRIGGER IF NOT EXISTS trg_partner_people_mir_from_section_${event}
AFTER ${event === 'insert' ? 'INSERT' : 'UPDATE OF section_draft, section_published, covered_by_signup_id, withdrawn_at'} ON partner_people
WHEN ${partnerNeeds('NEW')}
BEGIN
  ${AUDIT_COLUMNS}
  VALUES (${AUDIT_ID}, NEW.id, '${MIR_FROM_SECTION_ACTOR}', '${MIR_AUDIT_FIELD}', ${before(`COALESCE(NEW.designation_mir, '')`)}, ${partnerTargetMirSql('NEW')}, ${NOW});
  UPDATE partner_people SET designation_mir = ${partnerTargetMirSql('partner_people')} WHERE id = NEW.id;
END`

/** A volunteer's section (or number) changes: unnumbered „И аз“ rows they cover follow. */
const coveredFollow = `CREATE TRIGGER IF NOT EXISTS trg_signups_mir_to_covered_partners
AFTER UPDATE OF draft_section, published_section, designation_mir, designation_number ON signups
WHEN EXISTS (SELECT 1 FROM partner_people p WHERE p.covered_by_signup_id = NEW.id AND ${partnerNeeds('p')})
BEGIN
  ${AUDIT_COLUMNS}
  SELECT ${AUDIT_ID}, p.id, '${MIR_FROM_SECTION_ACTOR}', '${MIR_AUDIT_FIELD}', ${before(`COALESCE(p.designation_mir, '')`)}, ${partnerTargetMirSql('p')}, ${NOW}
  FROM partner_people p WHERE p.covered_by_signup_id = NEW.id AND ${partnerNeeds('p')};
  UPDATE partner_people SET designation_mir = ${partnerTargetMirSql('partner_people')}
  WHERE covered_by_signup_id = NEW.id AND ${partnerNeeds('partner_people')};
END`

export const MIR_FROM_SECTION_TRIGGER_NAMES = [
  'trg_signups_mir_from_section_insert',
  'trg_signups_mir_from_section_update',
  'trg_partner_people_mir_from_section_insert',
  'trg_partner_people_mir_from_section_update',
  'trg_signups_mir_to_covered_partners',
] as const

export const MIR_FROM_SECTION_TRIGGERS = [signupFill('insert'), signupFill('update'), partnerFollow('insert'), partnerFollow('update'), coveredFollow]

/**
 * One-off backfill (prepared, not run by the app): the same rules applied to rows that got a
 * section before the triggers existed. Audit first, then the change.
 */
export const MIR_FROM_SECTION_BACKFILL = [
  `${AUDIT_COLUMNS}
SELECT ${AUDIT_ID}, s.id, '${MIR_FROM_SECTION_ACTOR}', '${MIR_AUDIT_FIELD}', '—', ${signupSectionMirSql('s')}, ${NOW}
FROM signups s WHERE TRIM(COALESCE(s.mir_code, '')) = '' AND ${signupSectionMirSql('s')} != ''`,
  `UPDATE signups SET mir_code = ${signupSectionMirSql('signups')}
WHERE TRIM(COALESCE(mir_code, '')) = '' AND ${signupSectionMirSql('signups')} != ''`,
  `${AUDIT_COLUMNS}
SELECT ${AUDIT_ID}, p.id, '${MIR_FROM_SECTION_ACTOR}', '${MIR_AUDIT_FIELD}', ${before(`COALESCE(p.designation_mir, '')`)}, ${partnerTargetMirSql('p')}, ${NOW}
FROM partner_people p WHERE ${partnerNeeds('p')}`,
  `UPDATE partner_people SET designation_mir = ${partnerTargetMirSql('partner_people')}
WHERE ${partnerNeeds('partner_people')}`,
]

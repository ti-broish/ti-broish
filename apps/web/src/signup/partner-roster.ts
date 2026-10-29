// „И аз“ people on the Записвания list. Pure SQL builders, shared by the roster, the counts and
// every bulk, export and Brevo path, so the rules live in one place:
//
// - A partner row (partner_people, ids „pp-…“) shows on the list unless it is withdrawn or a
//   finished (submitted and confirmed) or already numbered volunteer has the same ЕГН or e-mail.
// - An unfinished signup (not submitted or not confirmed, no пълномощно number) that matches an
//   active partner row by ЕГН or e-mail is „merged“: the partner row stands for the person (its
//   section, number and signed file are the truth) and the signup row is hidden from the list.
//   Nothing is written; this is a join at read time.
// - Partner people never go to Brevo, and neither do merged signups: every Brevo, export and
//   bulk path filters signups through MERGED_SIGNUP_SQL and never reads partner_people.
import type { RosterView } from './admin-csv'
import { classifyAdminSearch, escapeLike, nameVariants } from './admin-search'

export type RosterSource = '' | 'tb' | 'iaz'
export const ROSTER_SOURCES = ['tb', 'iaz'] as const

const egnOf = (alias: string) => `REPLACE(COALESCE(${alias}.egn, ''), ' ', '')`
const emailOf = (alias: string) => `lower(TRIM(COALESCE(${alias}.email, '')))`

/** Same person: same non-empty ЕГН, or same non-empty e-mail (trimmed, any case). */
export function samePersonSql(signup: string, partner: string) {
  return `((${egnOf(signup)} != '' AND ${egnOf(signup)} = ${egnOf(partner)}) OR (${emailOf(partner)} != '' AND ${emailOf(partner)} = ${emailOf(signup)}))`
}

/** Active partner row (not withdrawn). */
export const partnerActiveSql = (alias: string) => `COALESCE(${alias}.withdrawn_at, '') = ''`

/** A signup that stands on its own next to a partner row: finished, or already holds a number. */
const signupStandsSql = (alias: string) =>
  `COALESCE(${alias}.withdrawn, 0) = 0 AND ((COALESCE(${alias}.submitted, 0) = 1 AND COALESCE(${alias}.email_confirmed, 0) = 1) OR ${alias}.designation_number IS NOT NULL)`

/** An active signup that is unfinished and not numbered: merged into a matching partner row. */
const signupMergeableSql = (alias: string) =>
  `COALESCE(${alias}.withdrawn, 0) = 0 AND (COALESCE(${alias}.submitted, 0) = 0 OR COALESCE(${alias}.email_confirmed, 0) = 0) AND ${alias}.designation_number IS NULL`

const NO_STANDING_VOLUNTEER_SQL = `NOT EXISTS (SELECT 1 FROM signups fs WHERE ${signupStandsSql('fs')} AND (${samePersonSql('fs', 'p')} OR fs.id = p.covered_by_signup_id))`

/** Partner row shown on the list (alias p): active, and no finished or numbered volunteer is the same person. */
export const PARTNER_SHOWN_SQL = `${partnerActiveSql('p')} AND ${NO_STANDING_VOLUNTEER_SQL}`

/**
 * Partner row on „Отписани“ (alias p): withdrawn („Отпиши“ or an оттеглено пълномощно), and the same
 * person is not already on the list as a volunteer, standing or отписан (one row per person).
 */
export const PARTNER_WITHDRAWN_SHOWN_SQL = `NOT (${partnerActiveSql('p')}) AND NOT EXISTS (SELECT 1 FROM signups fs WHERE (COALESCE(fs.withdrawn, 0) = 1 OR (${signupStandsSql('fs')})) AND (${samePersonSql('fs', 'p')} OR fs.id = p.covered_by_signup_id))`

/**
 * A signup (table „signups“, not aliased) merged into an „И аз“ row: hidden from the list, from
 * the counts and from every bulk, export and Brevo path. Use as `AND NOT ${MERGED_SIGNUP_SQL}`.
 */
export const MERGED_SIGNUP_SQL = `(${signupMergeableSql('signups')} AND EXISTS (SELECT 1 FROM partner_people mp WHERE ${partnerActiveSql('mp')} AND ${samePersonSql('signups', 'mp')}))`

/** Views where merged signups still show: they are about the signup itself (calls, withdrawals). */
const SIGNUP_ONLY_VIEWS: ReadonlySet<string> = new Set(['calls', 'queue', 'withdrawn'])

/** Hide merged signups from this view? Always for exports and Brevo, never for the call queues. */
export function hidesMergedSignups(view: string, exporting = false) {
  return exporting || !SIGNUP_ONLY_VIEWS.has(view)
}

/** The newest unfinished signup merged into partner row p (for „има и записване“). */
export const MERGED_SIGNUP_ID_SQL = `(SELECT ms.id FROM signups ms WHERE ${signupMergeableSql('ms')} AND ${samePersonSql('ms', 'p')} ORDER BY ms.updated_at DESC, ms.id LIMIT 1)`
const MERGED_SIGNUP_PHONE_SQL = `(SELECT json_extract(ms.payload, '$.phone') FROM signups ms WHERE ${signupMergeableSql('ms')} AND ${samePersonSql('ms', 'p')} ORDER BY ms.updated_at DESC, ms.id LIMIT 1)`

/** Finished signup that also has an active „И аз“ row (shown with a small marker). */
export const SIGNUP_HAS_PARTNER_SQL = `EXISTS (SELECT 1 FROM partner_people mp WHERE ${partnerActiveSql('mp')} AND ${samePersonSql('signups', 'mp')})`

/**
 * Partner rows for a roster view (alias p), or null when the view never holds partner people.
 * `shown` is the base filter: active rows, or withdrawn ones on „Отписани“. „И аз“ rows have no
 * „обработен“ mark, so a processed filter on „Отписани“ leaves them out.
 */
export function partnerViewWhere(view: RosterView | string, mir: string, processed = ''): { clause: string; binds: string[]; shown?: string } | null {
  const published = `COALESCE(p.section_published, '') != ''`
  if (view === 'withdrawn') return processed ? null : { clause: '1 = 1', binds: [], shown: PARTNER_WITHDRAWN_SHOWN_SQL }
  if (view === 'all') return { clause: '1 = 1', binds: [] }
  if (view === 'assigned') return { clause: published, binds: [] }
  if (view === 'unassigned') return { clause: `NOT (${published})`, binds: [] }
  if (view === 'draft') return { clause: `COALESCE(p.section_draft, '') != '' AND COALESCE(p.section_draft, '') != COALESCE(p.section_published, '')`, binds: [] }
  if (view === 'mir') {
    const code = mir.trim()
    if (!code) return null
    return { clause: 'p.designation_mir = ?', binds: [code.padStart(2, '0')] }
  }
  // finished / started / abroad / calls / queue / noemail are about our own signup form.
  return null
}

const P_PHONE_DIGITS = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.phone, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')`
const P_NAME_FIELDS = ["COALESCE(p.first_name, '')", "COALESCE(p.middle_name, '')", "COALESCE(p.last_name, '')"] as const
const P_TEXT_FIELDS = [
  "COALESCE(p.email, '')",
  ...P_NAME_FIELDS,
  "COALESCE(p.phone, '')",
  "COALESCE(p.egn, '')",
  "COALESCE(p.municipality_name, '')",
  "COALESCE(p.region_name, '')",
  "COALESCE(p.place_note, '')",
  "COALESCE(p.section_draft, '')",
  "COALESCE(p.section_published, '')",
  "COALESCE(p.designation_mir, '')",
  "COALESCE(CAST(p.designation_number AS TEXT), '')",
] as const

/** The admin search box over partner rows (alias p). Same classes as for signups: ЕГН, e-mail, phone, name, text. */
export function partnerSearchClause(query: string): { clause: string; binds: string[] } {
  const classified = classifyAdminSearch(query)
  if (classified.kind === 'empty') return { clause: '1 = 1', binds: [] }
  if (classified.kind === 'egn') return { clause: `${egnOf('p')} = ?`, binds: [classified.egn ?? ''] }
  if (classified.kind === 'email') {
    const email = classified.email ?? ''
    if (classified.emailExact) return { clause: `${emailOf('p')} = ?`, binds: [email] }
    return { clause: `${emailOf('p')} LIKE ? ESCAPE '\\'`, binds: [`${escapeLike(email)}%`] }
  }
  if (classified.kind === 'phone') {
    const exact = classified.phoneExact ?? []
    const parts = exact.map(() => `${P_PHONE_DIGITS} = ?`)
    const binds = [...exact]
    if (classified.phoneLast9) {
      parts.push(`${P_PHONE_DIGITS} LIKE ? ESCAPE '\\'`)
      binds.push(`%${classified.phoneLast9}`)
    }
    if (!parts.length) return { clause: '1 = 0', binds: [] }
    return { clause: `(${parts.join(' OR ')})`, binds }
  }
  if (classified.kind === 'name') {
    const tokens = classified.tokens ?? []
    const parts: string[] = []
    const binds: string[] = []
    for (const token of tokens) {
      const ors: string[] = []
      for (const variant of nameVariants(token)) {
        for (const field of P_NAME_FIELDS) {
          ors.push(`${field} LIKE ? ESCAPE '\\'`)
          binds.push(`%${escapeLike(variant)}%`)
        }
      }
      parts.push(`(${ors.join(' OR ')})`)
    }
    return { clause: `(${parts.join(' AND ')})`, binds }
  }
  const like = `%${escapeLike(classified.raw)}%`
  return { clause: `(${P_TEXT_FIELDS.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(' OR ')})`, binds: P_TEXT_FIELDS.map(() => like) }
}

/** Sort keys for the signups + partners union: [signup expression, partner expression]. */
const SORT_KEYS: Record<string, [string, string]> = {
  updated: ['COALESCE(updated_at, \'\')', "COALESCE(p.updated_at, p.imported_at, '')"],
  name: [
    "lower(COALESCE(json_extract(payload, '$.lastName'), '') || ' ' || COALESCE(json_extract(payload, '$.firstName'), ''))",
    "lower(COALESCE(p.last_name, '') || ' ' || COALESCE(p.first_name, ''))",
  ],
  email: ["lower(COALESCE(email, ''))", "lower(COALESCE(p.email, ''))"],
  phone: ["COALESCE(json_extract(payload, '$.phone'), '')", "COALESCE(p.phone, '')"],
  mir: ["COALESCE(mir_code, '')", "COALESCE(p.designation_mir, '')"],
  role: ["COALESCE(role, '')", "''"],
}

export function unionSortKeys(sort: string) {
  const [signup, partner] = SORT_KEYS[sort] ?? SORT_KEYS.updated!
  return { signup, partner }
}

/**
 * One page of ids over signups (WHERE signupClause) and shown partner rows (WHERE partnerClause),
 * ordered together. kind is 0 for a signup and 1 for a partner row.
 */
export function unionPageSql(signupClause: string, partnerClause: string, sort: string, dir: 'asc' | 'desc', partnerShown = PARTNER_SHOWN_SQL) {
  const keys = unionSortKeys(sort)
  const direction = dir === 'asc' ? 'ASC' : 'DESC'
  return `SELECT id, kind FROM (
    SELECT id, 0 AS kind, ${keys.signup} AS sort_key FROM signups WHERE ${signupClause}
    UNION ALL
    SELECT p.id AS id, 1 AS kind, ${keys.partner} AS sort_key FROM partner_people p WHERE ${partnerShown} AND ${partnerClause}
  ) ORDER BY sort_key ${direction}, id ${direction} LIMIT ? OFFSET ?`
}

export function partnerCountSql(partnerClause: string, partnerShown = PARTNER_SHOWN_SQL) {
  return `SELECT COUNT(*) AS n FROM partner_people p WHERE ${partnerShown} AND ${partnerClause}`
}

/** Partner rows by id, with the merged signup (if any) and its phone as a fallback contact. */
export function partnerRowsSql(count: number, withEgn: boolean) {
  return `SELECT p.id, p.partner, ${withEgn ? "COALESCE(p.egn, '')" : "''"} AS egn, COALESCE(p.email, '') AS email, COALESCE(p.phone, '') AS phone,
    COALESCE(p.first_name, '') AS first_name, COALESCE(p.middle_name, '') AS middle_name, COALESCE(p.last_name, '') AS last_name,
    COALESCE(p.region_code, '') AS region_code, COALESCE(p.region_name, '') AS region_name, COALESCE(p.municipality_name, '') AS municipality_name,
    COALESCE(p.place_note, '') AS place_note, COALESCE(p.designation_mir, '') AS designation_mir, p.designation_number,
    COALESCE(p.designation_signed_at, '') AS designation_signed_at, COALESCE(p.designation_pdf_url, '') AS designation_pdf_url,
    COALESCE(p.section_draft, '') AS section_draft, COALESCE(p.section_draft_locked, 0) AS section_draft_locked,
    COALESCE(p.section_published, '') AS section_published, COALESCE(p.updated_at, p.imported_at, '') AS updated_at,
    COALESCE(p.withdrawn_at, '') AS withdrawn_at, COALESCE(p.withdrawn_reason, '') AS withdrawn_reason,
    ${MERGED_SIGNUP_ID_SQL} AS merged_signup_id, ${MERGED_SIGNUP_PHONE_SQL} AS merged_signup_phone
    FROM partner_people p WHERE p.id IN (${Array.from({ length: count }, () => '?').join(', ')})`
}

export interface PartnerRosterRow {
  id: string
  partner: string
  egn: string
  email: string
  phone: string
  first_name: string
  middle_name: string
  last_name: string
  region_code: string
  region_name: string
  municipality_name: string
  place_note: string
  designation_mir: string
  designation_number: number | string | null
  designation_signed_at: string
  designation_pdf_url: string
  section_draft: string
  section_draft_locked: number
  section_published: string
  updated_at: string
  withdrawn_at?: string
  withdrawn_reason?: string
  merged_signup_id: string | null
  merged_signup_phone: string | null
}

/** Count summary SQL: signups without merged ones, plus shown partner rows (no double-counting). */
export const PARTNER_SUMMARY_SQL = `SELECT COUNT(*) AS partners,
  COALESCE(SUM(CASE WHEN COALESCE(p.section_published, '') != '' THEN 1 ELSE 0 END), 0) AS assigned
  FROM partner_people p WHERE ${PARTNER_SHOWN_SQL}`

/**
 * Секции: shown „И аз“ rows for the page's scope (alias p), or null when the scope holds none.
 * „Цялата страна“ = all, a МИР = the пълномощно МИР, „Чужбина“ = МИР 32.
 */
export function partnerSectionsScope(view: RosterView | string, mir: string): { clause: string; binds: string[] } | null {
  if (view === 'all') return { clause: '1 = 1', binds: [] }
  if (view === 'abroad') return { clause: "COALESCE(p.designation_mir, '') = '32'", binds: [] }
  if (view === 'mir') {
    const code = mir.trim()
    if (!code) return null
    return { clause: 'p.designation_mir = ?', binds: [code.padStart(2, '0')] }
  }
  return null
}

const P_PUBLISHED = `COALESCE(p.section_published, '') != ''`
const P_DRAFTED = `COALESCE(p.section_draft, '') != ''`

/** The three Секции states for a partner row (alias p), same rules as for signups (draft = pending draft). */
export const PARTNER_SECTION_STATE_SQL = {
  none: `NOT (${P_PUBLISHED}) AND NOT (${P_DRAFTED})`,
  draft: `${P_DRAFTED} AND COALESCE(p.section_draft, '') != COALESCE(p.section_published, '')`,
  published: P_PUBLISHED,
} as const

/** Per-state counts of shown partner rows in a Секции scope (same columns as sectionCountsSql). */
export function partnerSectionCountsSql(partnerClause: string) {
  return `SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN ${PARTNER_SECTION_STATE_SQL.none} THEN 1 ELSE 0 END), 0) AS none,
    COALESCE(SUM(CASE WHEN ${PARTNER_SECTION_STATE_SQL.draft} THEN 1 ELSE 0 END), 0) AS draft,
    COALESCE(SUM(CASE WHEN ${PARTNER_SECTION_STATE_SQL.published} THEN 1 ELSE 0 END), 0) AS published
  FROM partner_people p WHERE ${PARTNER_SHOWN_SQL} AND ${partnerClause}`
}

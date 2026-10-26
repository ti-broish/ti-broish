import type { SignupD1 } from './db-core'
import { loadAbroadSectionsOrNull } from './abroad-sections'
import { isSpecialBulgariaSection } from './stationary-sections'
import { PARTNER_HELD_SQL, PARTNER_RESERVATION_ORG } from './partner-people-sql'
import { conflictsFor, reservedCode, type AssignedPerson, type ExistingReservation } from './reserved-sections'

/** Organisation that reserved this section, or null. Codes are compared as 9 digits. */
export async function reservedOrgOf(db: SignupD1, section: string) {
  const code = reservedCode(section)
  if (!code) return null
  const row = await db.prepare('SELECT organisation FROM taken_sections WHERE section_code = ?').bind(code).first<{ organisation: string }>()
  if (row?.organisation) return row.organisation
  return (await partnerHeldCodes(db)).has(code) ? PARTNER_RESERVATION_ORG : null
}

/** Shown as the „organisation“ when a section is a target of a mobile team's area. */
export const MOBILE_TARGET_ORG = 'мобилен екип'

/**
 * A section another person's mobile-team area targets (mobile_drafts.targets), or null. A mobile
 * team never doubles up on a section volunteer: such a section is refused like a reservation.
 * The person's own area does not count (a mobile volunteer's section may be one of their targets).
 */
export async function mobileTargetOrgOf(db: Pick<SignupD1, 'prepare'>, section: string, personId: string) {
  const code = reservedCode(section)
  if (!code) return null
  try {
    const row = await db
      .prepare(`SELECT 1 AS x FROM mobile_drafts m, json_each(m.targets) j WHERE json_extract(j.value, '$.code') = ? AND m.signup_id != ? LIMIT 1`)
      .bind(code, personId)
      .first<{ x: number }>()
    return row ? MOBILE_TARGET_ORG : null
  } catch {
    return null
  }
}

/** Mobile-team target codes; with manualOnly, only areas saved by hand (automatic areas are re-planned). */
export async function mobileTargetCodes(db: Pick<SignupD1, 'prepare'>, manualOnly: boolean) {
  try {
    const result = await db
      .prepare(`SELECT json_extract(j.value, '$.code') AS code FROM mobile_drafts m, json_each(m.targets) j${manualOnly ? " WHERE m.source = 'manual'" : ''}`)
      .all<{ code: string }>()
    return new Set((result.results ?? []).map((row) => reservedCode(String(row.code ?? ''))).filter(Boolean))
  } catch {
    return new Set<string>()
  }
}

/**
 * Sections a „И аз“ partner person holds as a draft or published. To every signup path they
 * count as reserved by „И аз“ (one person per section). Empty before the columns exist.
 */
export async function partnerHeldCodes(db: Pick<SignupD1, 'prepare'>) {
  try {
    const result = await db.prepare(PARTNER_HELD_SQL).all<{ code: string }>()
    return new Set((result.results ?? []).map((row) => reservedCode(row.code)).filter(Boolean))
  } catch {
    return new Set<string>()
  }
}

export async function loadReservations(db: SignupD1): Promise<Array<ExistingReservation & { mirCode: string; createdAt: string }>> {
  const result = await db
    .prepare(`SELECT section_code, organisation, COALESCE(note, '') AS note, COALESCE(place, '') AS place, COALESCE(mir_code, '') AS mir_code, created_at FROM taken_sections`)
    .all<{ section_code: string; organisation: string; note: string; place: string; mir_code: string; created_at: string }>()
  return (result.results ?? []).map((row) => ({
    sectionCode: row.section_code,
    organisation: row.organisation,
    note: row.note,
    place: row.place,
    mirCode: row.mir_code,
    createdAt: row.created_at,
  }))
}

/** Reservations plus partner-held sections (as „И аз“): everything a signup may not take. */
export async function reservedMap(db: SignupD1) {
  const map = new Map((await loadReservations(db)).map((row) => [row.sectionCode, row.organisation]))
  for (const code of await partnerHeldCodes(db)) if (!map.has(code)) map.set(code, PARTNER_RESERVATION_ORG)
  return map
}

export async function loadAssignedPeople(db: SignupD1): Promise<AssignedPerson[]> {
  const result = await db
    .prepare(
      `SELECT id, email,
              TRIM(COALESCE(json_extract(payload, '$.firstName'), '') || ' ' || COALESCE(json_extract(payload, '$.lastName'), '')) AS name,
              COALESCE(draft_section, '') AS draft_section, COALESCE(published_section, '') AS published_section
       FROM signups
       WHERE COALESCE(withdrawn, 0) = 0 AND (COALESCE(draft_section, '') != '' OR COALESCE(published_section, '') != '')`,
    )
    .all<{ id: string; email: string; name: string; draft_section: string; published_section: string }>()
  return (result.results ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    draftSection: row.draft_section,
    publishedSection: row.published_section,
  }))
}

export async function loadConflicts(db: SignupD1) {
  return conflictsFor(await reservedMap(db), await loadAssignedPeople(db))
}

/** Known: a domestic code in the CIK list, or an abroad code in the API (/sections/abroad) or the abroad priority list. */
export async function knownSectionCheck(db: SignupD1) {
  const [abroad, fromApi] = await Promise.all([
    db.prepare('SELECT section_code FROM abroad_priority_sections').all<{ section_code: string }>(),
    loadAbroadSectionsOrNull(),
  ])
  const abroadCodes = new Set((abroad.results ?? []).map((row) => reservedCode(row.section_code)))
  return (code: string) => {
    if (code.startsWith('32')) return Boolean(fromApi?.sections[code]) || abroadCodes.has(code)
    return !isSpecialBulgariaSection(code)
  }
}

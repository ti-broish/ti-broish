import { readPollingSections, readTownIds } from './distribute'
import { PARTNER_RESERVATION_ORG } from './partner-people-sql'
import { IMPORT_REGIONS } from './partner-import-regions.data'
import { foldPlace, rKey } from './priority-sections'
import { sectionDesk } from './sections'

/**
 * Sections for „И аз“ partner people. Pure planning, shared by the admin tab and the one-off
 * script, so a dry run and a write always agree. Each person stays in their МИР (the пълномощно
 * is for the МИР): their named municipality first, else anywhere in the МИР. Priority sections
 * first by R desc; ordinary sections only paper or unknown (machine only when priority). A held
 * section (signup, partner, mobile target, reservation) is never offered. Nothing here writes,
 * mails or syncs.
 */

export interface PartnerSectionPerson {
  id: string
  mir: string
  regionCode: string
  municipality: string
  note: string
  draft: string
  published: string
}

export interface PartnerCandidate {
  code: string
  town: string
  municipality: string
  place: string
  priority: { r: number | null; level: string } | null
  isMachine?: boolean | null
  votersCount?: number | null
}

export type PartnerScope = 'town' | 'municipality' | 'mir'

export interface PartnerSectionDraft {
  personId: string
  mir: string
  code: string
  scope: PartnerScope
  priority: { r: number | null; level: string } | null
}

export type PartnerSkipReason = 'no-mir' | 'no-section' | 'has-section'

export interface PartnerSectionPlan {
  drafts: PartnerSectionDraft[]
  skipped: Array<{ personId: string; mir: string; reason: PartnerSkipReason }>
}

export interface PriorityRow {
  section_code: string
  town: string
  municipality: string
  r: number | null
  level: string
}

/**
 * Every held code: reservations, live signups (draft or published), partners, mobile targets.
 * D1 allows at most 5 terms in one compound SELECT, so the signup and partner draft rows are nested.
 */
export const PARTNER_BLOCKED_SQL = `SELECT h.code AS code, h.src AS src FROM (
  SELECT draft_section AS code, 'signup' AS src FROM signups WHERE COALESCE(withdrawn, 0) = 0 AND COALESCE(draft_section, '') != ''
  UNION ALL SELECT published_section, 'signup' FROM signups WHERE COALESCE(withdrawn, 0) = 0 AND COALESCE(published_section, '') != ''
  UNION ALL SELECT section_draft, 'partner:' || id FROM partner_people WHERE COALESCE(section_draft, '') != ''
) h
UNION ALL SELECT section_published, 'partner:' || id FROM partner_people WHERE COALESCE(section_published, '') != ''
UNION ALL SELECT section_code, 'taken' FROM taken_sections
UNION ALL SELECT json_extract(j.value, '$.code'), 'mobile' FROM mobile_drafts m, json_each(m.targets) j`

export const PARTNER_SECTION_PEOPLE_SQL = `SELECT id, COALESCE(designation_mir, '') AS mir, region_code, municipality_name, place_note,
  COALESCE(section_draft, '') AS section_draft, COALESCE(section_published, '') AS section_published
FROM partner_people ORDER BY designation_mir, designation_number, id`

export const PARTNER_PRIORITY_SQL = 'SELECT section_code, town, municipality, r, level FROM priority_sections'

export function partnerPersonFrom(row: {
  id: string
  mir: string
  region_code: string
  municipality_name: string
  place_note: string
  section_draft: string
  section_published: string
}): PartnerSectionPerson {
  return {
    id: row.id,
    mir: (row.mir ?? '').trim(),
    regionCode: row.region_code ?? '',
    municipality: row.municipality_name ?? '',
    note: row.place_note ?? '',
    draft: code9(row.section_draft ?? ''),
    published: code9(row.section_published ?? ''),
  }
}

/** Held codes, minus what `ownId` holds itself (so a re-suggest can keep its own draft). */
export function blockedCodes(rows: Array<{ code: string; src: string }>, ownId = '') {
  const own = ownId ? `partner:${ownId}` : ''
  const blocked = new Set<string>()
  for (const row of rows) {
    if (own && row.src === own) continue
    const code = code9(row.code ?? '')
    if (code) blocked.add(code)
  }
  return blocked
}

export function code9(value: string) {
  const digits = String(value).replace(/\D/g, '')
  if (digits.length === 8) return `0${digits}`
  return digits.length === 9 ? digits : ''
}

/** The municipality code (2 digits) of the person's named municipality, or ''. */
export function municipalityCodeOf(person: Pick<PartnerSectionPerson, 'regionCode' | 'municipality' | 'mir'>) {
  const name = foldPlace(person.municipality)
  if (!name) return ''
  const region =
    IMPORT_REGIONS.find((item) => item.code === person.regionCode) ?? IMPORT_REGIONS.find((item) => item.code === person.mir)
  const found = region?.municipalities.find(([, municipality]) => foldPlace(municipality) === name)
  return found?.[0] ?? ''
}

export function priorityCandidates(rows: PriorityRow[]): PartnerCandidate[] {
  return rows
    .map((row) => ({
      code: code9(row.section_code),
      town: row.town ?? '',
      municipality: row.municipality ?? '',
      place: '',
      priority: { r: row.r === null || row.r === undefined ? null : Number(row.r), level: row.level ?? '' },
    }))
    .filter((row) => row.code && !row.code.startsWith('32'))
}

/** True when the plan needs ordinary sections of this municipality: fewer open priority sections than people. */
export function municipalitiesToFetch(people: PartnerSectionPerson[], candidates: PartnerCandidate[], blocked: ReadonlySet<string>) {
  const need = new Map<string, number>()
  for (const person of people) {
    if (!person.mir || person.draft || person.published) continue
    const muni = municipalityCodeOf(person)
    if (!muni) continue
    const key = `${person.mir}:${muni}`
    need.set(key, (need.get(key) ?? 0) + 1)
  }
  const out: Array<{ mir: string; municipality: string; name: string }> = []
  for (const [key, count] of need) {
    const [mir, municipality] = key.split(':') as [string, string]
    const person = people.find((item) => item.mir === mir && municipalityCodeOf(item) === municipality)!
    const open = candidates.filter((row) => row.code.startsWith(mir) && !blocked.has(row.code) && sameMunicipality(row, person, municipality)).length
    if (open < count) out.push({ mir, municipality, name: person.municipality })
  }
  return out
}

/** Ordinary sections of one municipality, from the public section API. */
export async function ordinaryCandidates(
  getJson: (path: string) => Promise<unknown>,
  mir: string,
  municipality: string,
  municipalityName: string,
): Promise<PartnerCandidate[]> {
  const towns = readTownIds(await getJson(`towns?country=000&election_region=${mir}&municipality=${municipality}`))
  const out: PartnerCandidate[] = []
  for (const townId of towns) {
    for (const section of readPollingSections(await getJson(`sections?town=${townId}`), townId)) {
      if (!section.id.startsWith(`${mir}${municipality}`) || section.isMobile) continue
      out.push({
        code: section.id,
        town: '',
        municipality: municipalityName,
        place: section.place,
        priority: null,
        isMachine: section.isMachine ?? null,
        votersCount: section.votersCount ?? null,
      })
    }
  }
  return out
}

function sameMunicipality(candidate: PartnerCandidate, person: Pick<PartnerSectionPerson, 'municipality'>, municipality: string) {
  if (candidate.code.slice(2, 4) === municipality) return true
  return Boolean(candidate.municipality) && foldPlace(candidate.municipality) === foldPlace(person.municipality)
}

/** A town named in the free-text note, as a whole word (3+ letters). */
function townInNote(candidate: PartnerCandidate, note: string) {
  const town = foldPlace(candidate.town)
  if (town.length < 3) return false
  const text = ` ${foldPlace(note).replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  return text.includes(` ${town} `)
}

function scopeOf(candidate: PartnerCandidate, person: PartnerSectionPerson, municipality: string): PartnerScope {
  const local = municipality ? sameMunicipality(candidate, person, municipality) : false
  if (local && candidate.priority && townInNote(candidate, person.note)) return 'town'
  return local ? 'municipality' : 'mir'
}

/** Paper or unknown, or a machine section on the priority list (same rule as signups). */
function draftable(candidate: PartnerCandidate) {
  return Boolean(candidate.priority) || sectionDesk({ votersCount: candidate.votersCount ?? null, isMachine: candidate.isMachine ?? null }) !== 'machine'
}

/**
 * Tier: local priority (named town, then municipality), local ordinary, priority elsewhere in
 * the МИР. Inside a tier: priority by R desc; ordinary by the least used address (balance), paper first.
 */
function tier(candidate: PartnerCandidate, scope: PartnerScope) {
  if (candidate.priority) return scope === 'town' ? 0 : scope === 'municipality' ? 1 : 3
  return scope === 'mir' ? 4 : 2
}

export function rankForPerson(
  person: PartnerSectionPerson,
  candidates: PartnerCandidate[],
  blocked: ReadonlySet<string>,
  placeUse: ReadonlyMap<string, number> = new Map(),
) {
  const mir = person.mir.padStart(2, '0')
  const municipality = municipalityCodeOf(person)
  const seen = new Set<string>()
  const ranked: Array<{ candidate: PartnerCandidate; scope: PartnerScope; tier: number }> = []
  for (const candidate of candidates) {
    if (!candidate.code.startsWith(mir) || blocked.has(candidate.code) || seen.has(candidate.code)) continue
    if (!draftable(candidate)) continue
    seen.add(candidate.code)
    const scope = scopeOf(candidate, person, municipality)
    ranked.push({ candidate, scope, tier: tier(candidate, scope) })
  }
  const desk = (candidate: PartnerCandidate) => {
    const value = sectionDesk({ votersCount: candidate.votersCount ?? null, isMachine: candidate.isMachine ?? null })
    return value === 'paper' ? 0 : value === 'unknown' ? 1 : 2
  }
  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.candidate.priority && b.candidate.priority) {
      const ra = rKey(a.candidate.priority.r)
      const rb = rKey(b.candidate.priority.r)
      if (ra !== rb) return rb > ra ? 1 : -1
    }
    const used = (placeUse.get(a.candidate.place) ?? 0) - (placeUse.get(b.candidate.place) ?? 0)
    if (used !== 0) return used
    const d = desk(a.candidate) - desk(b.candidate)
    if (d !== 0) return d
    return a.candidate.code.localeCompare(b.candidate.code)
  })
  return ranked
}

/** Drafts for people with no section yet. Others keep theirs. */
export function planPartnerSections(input: {
  people: PartnerSectionPerson[]
  candidates: PartnerCandidate[]
  blocked: ReadonlySet<string>
}): PartnerSectionPlan {
  const blocked = new Set(input.blocked)
  const plan: PartnerSectionPlan = { drafts: [], skipped: [] }
  const placeUse = new Map<string, number>()
  // People with a named municipality first, so the open МИР sections stay for those without one.
  const order = [...input.people].sort(
    (a, b) => a.mir.localeCompare(b.mir) || Number(!municipalityCodeOf(a)) - Number(!municipalityCodeOf(b)) || a.id.localeCompare(b.id),
  )
  for (const person of order) {
    if (person.draft || person.published) {
      plan.skipped.push({ personId: person.id, mir: person.mir, reason: 'has-section' })
      continue
    }
    if (!/^\d{2}$/.test(person.mir)) {
      plan.skipped.push({ personId: person.id, mir: person.mir, reason: 'no-mir' })
      continue
    }
    const best = rankForPerson(person, input.candidates, blocked, placeUse)[0]
    if (!best) {
      plan.skipped.push({ personId: person.id, mir: person.mir, reason: 'no-section' })
      continue
    }
    blocked.add(best.candidate.code)
    if (best.candidate.place) placeUse.set(best.candidate.place, (placeUse.get(best.candidate.place) ?? 0) + 1)
    plan.drafts.push({ personId: person.id, mir: person.mir, code: best.candidate.code, scope: best.scope, priority: best.candidate.priority })
  }
  return plan
}

export function describePartnerPlan(plan: PartnerSectionPlan) {
  const count = (reason: PartnerSkipReason) => plan.skipped.filter((row) => row.reason === reason).length
  const priority = plan.drafts.filter((row) => row.priority).length
  const parts = [`чернови ${plan.drafts.length} (приоритетни ${priority})`]
  if (count('has-section')) parts.push(`вече със секция ${count('has-section')}`)
  if (count('no-section')) parts.push(`без свободна секция в МИР ${count('no-section')}`)
  if (count('no-mir')) parts.push(`без МИР ${count('no-mir')}`)
  return `${parts.join(' · ')}. Без публикуване, без писма и без Brevo.`
}

/** Guarded write: only people still without a section; the triggers refuse a held section. */
export const PARTNER_DRAFT_WRITE_SQL = `UPDATE partner_people
SET section_draft = ?, section_draft_locked = 0, section_draft_source = 'auto', section_drafted_at = ?, updated_at = ?
WHERE id = ? AND COALESCE(section_draft, '') = '' AND COALESCE(section_published, '') = ''`

const RESERVATION_NOTE = 'Разпределение „И аз“'

type StatementMaker<S> = { prepare(sql: string): { bind(...values: unknown[]): S } }

/**
 * Publish one partner person: section_published = section_draft plus the „И аз“ reservation
 * (and the old „И аз“ reservation goes). Run as one batch, so a trigger refusal rolls it all back.
 */
export function publishStatements<S>(db: StatementMaker<S>, row: { id: string; mir: string; draft: string; published: string }, now: string) {
  const statements: S[] = []
  if (row.published) {
    statements.push(
      db.prepare(`DELETE FROM taken_sections WHERE section_code = ? AND organisation = ?`).bind(row.published, PARTNER_RESERVATION_ORG),
    )
  }
  statements.push(
    db.prepare(`UPDATE partner_people SET section_published = section_draft, section_published_at = ?, updated_at = ? WHERE id = ? AND section_draft = ?`).bind(now, now, row.id, row.draft),
    db
      .prepare(
        `INSERT INTO taken_sections (section_code, mir_code, place, organisation, note, created_at) VALUES (?, ?, '', ?, ?, ?)
         ON CONFLICT(section_code) DO NOTHING`,
      )
      .bind(row.draft, row.draft.slice(0, 2), PARTNER_RESERVATION_ORG, RESERVATION_NOTE, now),
  )
  return statements
}

export function unpublishStatements<S>(db: StatementMaker<S>, row: { id: string; published: string }, now: string) {
  return [
    db.prepare(`DELETE FROM taken_sections WHERE section_code = ? AND organisation = ?`).bind(row.published, PARTNER_RESERVATION_ORG),
    db
      .prepare(`UPDATE partner_people SET section_published = NULL, section_published_at = NULL, section_draft = COALESCE(section_draft, ?), updated_at = ? WHERE id = ?`)
      .bind(row.published, now, row.id),
  ]
}


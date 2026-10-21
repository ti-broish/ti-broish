import type { SignupD1 } from './db-core'
import { mentionsWholeMir, mobileAreas, planMobileTeams, type MobileArea, type MobilePerson, type MobilePrioritySection, type MobileTarget } from './mobile-teams'

/** Reads for mobile-team drafts. No writes here; see mobile-teams-admin.ts. */
type Database = Pick<SignupD1, 'prepare'>

export interface MobileDraftRow {
  signupId: string
  teamKey: string
  mir: string
  municipality: string
  areaKey: string
  areaLabel: string
  targets: MobileTarget[]
  source: string
  updatedAt: string
}

const MOBILE = `(COALESCE(s.role, '') = 'mobile' OR json_extract(s.payload, '$.mobileTeam') = 1)`

interface PersonRow {
  id: string
  email: string
  mir: string
  region_code: string
  radius: string
  town: string
  municipality_code: string
  city_region_code: string
  extra_city_regions: string
  distant_region_codes: string
  travel_municipalities: string
  has_car: number | null
  car_seats: number | null
  has_drone: number | null
  rounds_first: number | null
  rounds_runoff: number | null
  section: string
  note_text: string
}

/** Mobile-team people. `missing` keeps those with no draft, no published section and no mobile draft. */
export async function loadMobilePeople(db: Database, filter: { missing?: boolean; id?: string } = {}): Promise<MobilePerson[]> {
  const where = [`COALESCE(s.submitted, 0) = 1`, `COALESCE(s.withdrawn, 0) = 0`, MOBILE]
  if (filter.missing) {
    where.push(`COALESCE(s.draft_section, '') = ''`, `COALESCE(s.published_section, '') = ''`, `NOT EXISTS (SELECT 1 FROM mobile_drafts m WHERE m.signup_id = s.id)`)
  }
  const statement = db.prepare(
    `SELECT s.id, s.email,
            COALESCE(s.mir_code, '') AS mir,
            COALESCE(s.region_code, '') AS region_code,
            COALESCE(s.radius, json_extract(s.payload, '$.radius'), '') AS radius,
            COALESCE(json_extract(s.payload, '$.place.townName'), s.town_name, '') AS town,
            COALESCE(json_extract(s.payload, '$.place.municipalityCode'), '') AS municipality_code,
            COALESCE(s.city_region_code, json_extract(s.payload, '$.place.cityRegionCode'), '') AS city_region_code,
            COALESCE(s.extra_city_regions, '[]') AS extra_city_regions,
            COALESCE(s.distant_region_codes, '[]') AS distant_region_codes,
            COALESCE(s.travel_municipalities, '[]') AS travel_municipalities,
            s.has_car, s.car_seats, s.has_drone, s.rounds_first, s.rounds_runoff,
            COALESCE(NULLIF(s.published_section, ''), s.draft_section, '') AS section,
            COALESCE(s.staff_note, '') || ' ' || COALESCE(s.notes, '') || ' ' || COALESCE(json_extract(s.payload, '$.notes'), '') AS note_text
     FROM signups s
     WHERE ${where.join(' AND ')}${filter.id ? ' AND s.id = ?' : ''}`,
  )
  const result = await (filter.id ? statement.bind(filter.id) : statement).all<PersonRow>()
  const rows = result.results ?? []
  const companions = await db
    .prepare(
      `SELECT c.signup_id, c.email, c.in_group, c.same_place FROM companions c JOIN signups s ON s.id = c.signup_id
       WHERE COALESCE(s.withdrawn, 0) = 0 AND ${MOBILE}`,
    )
    .all<{ signup_id: string; email: string; in_group: number; same_place: number }>()
  const bySignup = new Map<string, MobilePerson['companions']>()
  for (const row of companions.results ?? []) {
    bySignup.set(row.signup_id, [...(bySignup.get(row.signup_id) ?? []), { email: row.email, inGroup: row.in_group !== 0, samePlace: row.same_place !== 0 }])
  }
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    mir: row.mir,
    regionCode: row.region_code,
    radius: row.radius,
    townName: row.town,
    municipalityCode: row.municipality_code,
    cityRegionCode: row.city_region_code,
    extraCityRegionCodes: jsonList(row.extra_city_regions).map((item) => (typeof item === 'object' && item ? String((item as { code?: unknown }).code ?? '') : String(item))).filter(Boolean),
    distantMirs: jsonList(row.distant_region_codes).map(String).filter(Boolean),
    travelStops: jsonList(row.travel_municipalities)
      .map((item) => item as { regionCode?: string; code?: string })
      .filter((item) => item && item.regionCode && item.code)
      .map((item) => ({ regionCode: String(item.regionCode), code: String(item.code) })),
    hasCar: row.has_car === null || row.has_car === undefined ? null : row.has_car !== 0,
    carSeats: Number(row.car_seats ?? 0),
    hasDrone: row.has_drone === null || row.has_drone === undefined ? null : row.has_drone !== 0,
    roundsFirst: row.rounds_first !== 0,
    roundsRunoff: row.rounds_runoff !== 0,
    companions: bySignup.get(row.id) ?? [],
    pinnedMir: sectionMir(row.section),
    wholeMir: mentionsWholeMir(row.note_text),
  }))
}

export async function loadMobileDrafts(db: Database): Promise<MobileDraftRow[]> {
  const result = await db
    .prepare('SELECT signup_id, team_key, mir_code, municipality_code, area_key, area_label, targets, source, updated_at FROM mobile_drafts')
    .all<{ signup_id: string; team_key: string; mir_code: string; municipality_code: string; area_key: string; area_label: string; targets: string; source: string; updated_at: string }>()
  return (result.results ?? []).map((row) => ({
    signupId: row.signup_id,
    teamKey: row.team_key,
    mir: row.mir_code,
    municipality: row.municipality_code,
    areaKey: row.area_key,
    areaLabel: row.area_label,
    targets: parseTargets(row.targets),
    source: row.source,
    updatedAt: row.updated_at,
  }))
}

/**
 * What a mobile team may target: priority sections with no section person (draft or published),
 * not reserved by another org, and not already a target of another mobile team.
 */
export async function loadMobileContext(db: Database, options: { exceptTeam?: string } = {}) {
  const priorityResult = await db
    .prepare('SELECT section_code, town, municipality, r, level FROM priority_sections')
    .all<{ section_code: string; town: string; municipality: string; r: number | null; level: string }>()
  const priority: MobilePrioritySection[] = (priorityResult.results ?? []).map((row) => ({
    sectionCode: row.section_code,
    town: row.town ?? '',
    municipality: row.municipality ?? '',
    r: row.r === null || row.r === undefined ? null : Number(row.r),
    level: row.level ?? '',
  }))
  const unavailable = new Set<string>()
  const held = await db
    .prepare(
      `SELECT COALESCE(draft_section, '') AS draft_section, COALESCE(published_section, '') AS published_section FROM signups
       WHERE COALESCE(withdrawn, 0) = 0 AND (COALESCE(draft_section, '') != '' OR COALESCE(published_section, '') != '')`,
    )
    .all<{ draft_section: string; published_section: string }>()
  for (const row of held.results ?? []) {
    if (row.draft_section) unavailable.add(row.draft_section)
    if (row.published_section) unavailable.add(row.published_section)
  }
  const taken = await db.prepare('SELECT section_code FROM taken_sections').all<{ section_code: string }>()
  const reserved = new Set((taken.results ?? []).map((row) => row.section_code))
  for (const code of reserved) unavailable.add(code)
  const drafts = await loadMobileDrafts(db)
  const teamsPerMir = new Map<string, number>()
  const seenTeams = new Set<string>()
  for (const draft of drafts) {
    if (draft.teamKey === options.exceptTeam) continue
    for (const target of draft.targets) unavailable.add(target.code)
    if (!seenTeams.has(draft.teamKey)) {
      seenTeams.add(draft.teamKey)
      teamsPerMir.set(draft.mir, (teamsPerMir.get(draft.mir) ?? 0) + 1)
    }
  }
  return { priority, unavailable, reserved, teamsPerMir, drafts }
}

/** The country-wide plan for mobile people who have nothing yet. Read-only. */
export async function planMobileFromDb(db: Database) {
  const people = await loadMobilePeople(db, { missing: true })
  const context = await loadMobileContext(db)
  const plan = planMobileTeams({ people, priority: context.priority, unavailable: context.unavailable, teamsPerMir: context.teamsPerMir })
  return { people, context, plan }
}

/** The best open areas within one mobile person's reach, with targets. */
export async function suggestMobileAreas(db: Database, signupId: string, limit = 5): Promise<{ person: MobilePerson | null; areas: MobileArea[] }> {
  const [person] = await loadMobilePeople(db, { id: signupId })
  if (!person) return { person: null, areas: [] }
  const own = (await loadMobileDrafts(db)).find((draft) => draft.signupId === signupId)
  const context = await loadMobileContext(db, { exceptTeam: own?.teamKey })
  const open = context.priority.filter((section) => !context.unavailable.has(section.sectionCode))
  return { person, areas: mobileAreas([person], open, context.teamsPerMir).slice(0, limit) }
}

/** The МИР of a section code (first two of nine digits), or ''. */
export function sectionMir(code: string | null | undefined) {
  const digits = String(code ?? '').replace(/\D/g, '')
  return digits.length === 9 ? digits.slice(0, 2) : ''
}

export function parseTargets(raw: string): MobileTarget[] {
  return jsonList(raw)
    .map((item) => item as Partial<MobileTarget>)
    .filter((item) => item && typeof item.code === 'string')
    .map((item) => ({ code: String(item.code), r: typeof item.r === 'number' ? item.r : null, level: String(item.level ?? ''), town: String(item.town ?? '') }))
}

function jsonList(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

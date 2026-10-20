import { normalizeSection } from './admin-csv'
import {
  distributeSections,
  distributionHold,
  heldSectionCodes,
  readPollingSections,
  readTownIds,
  relevantPrefixes,
  votersFromResults,
  type DistributeAnchor,
  type DistributeCompanion,
  type DistributePerson,
  type DistributeSection,
} from './distribute'
import type { SignupD1 } from './db-core'
import { partnerHeldCodes } from './reserved-sections-db'

/**
 * Country-wide draft distribution, shared by „Направи чернови“ (admin-distribute.ts) and any
 * dry run. Reads only: it loads people, held sections, priority sections and the public section
 * lists, and returns the plan. Writing drafts stays in admin-distribute.ts.
 */
type Database = Pick<SignupD1, 'prepare'>

const API = 'https://api.tibroish.bg'
const HEADERS = { Accept: 'application/json', 'Accept-Language': 'bg-BG' }

export interface DistributionOptions {
  /** Keep every existing draft (not only „Запази“) and draft only people with no section at all. */
  keepDrafts?: boolean
  fetchJson?: (path: string) => Promise<unknown>
}

export async function planCountryDistribution(db: Database, options: DistributionOptions = {}) {
  const getJson = options.fetchJson ?? fetchApiJson
  const keepDrafts = options.keepDrafts === true
  const loaded = await loadPeople(db, keepDrafts)
  const blocked = await blockedSections(db, keepDrafts)
  const priority = await loadPriorityMap(db)
  const townIds = new Set<number>()
  const municipalities = new Set<string>()
  for (const person of loaded.candidates) {
    if (person.townId != null) townIds.add(person.townId)
    if ((person.radius === 'municipality' || person.radius === 'region' || person.radius === 'distant') && person.municipalityCode && person.mir) {
      municipalities.add(`${person.mir.padStart(2, '0')}:${person.municipalityCode.padStart(2, '0')}`)
    }
    for (const stop of person.travelStops) {
      const mir = stop.regionCode.trim().padStart(2, '0')
      const code = stop.code.trim().padStart(2, '0')
      if (/^\d{2}$/.test(mir) && /^\d{2}$/.test(code)) municipalities.add(`${mir}:${code}`)
    }
  }
  const municipalityTowns = await pool([...municipalities], 6, async (key) => {
    const [mir, code] = key.split(':')
    return readTownIds(await getJson(`towns?country=000&election_region=${mir}&municipality=${code}`))
  })
  for (const ids of municipalityTowns) for (const id of ids) townIds.add(id)

  const lists = await pool([...townIds], 6, async (townId) => readPollingSections(await getJson(`sections?town=${townId}`), townId))
  const fetched = lists.reduce((count, list) => count + list.length, 0)
  if (loaded.candidates.length > 0 && townIds.size > 0 && fetched === 0) {
    return { ok: false as const, message: 'Не можах да заредя секциите. Опитай пак след малко.' }
  }
  const sections = mergeSections(lists.flat())
  const voters = new Map<string, number>()
  const prefixes = relevantPrefixes(loaded.candidates, sections)
  const voterMaps = await pool(prefixes, 6, async (prefix) => votersFromResults(await getJson(`results/${prefix}.json`)))
  for (const map of voterMaps) for (const [id, count] of map) voters.set(id, count)
  const counted = sections.map((section) => ({ ...section, votersCount: voters.get(section.id) ?? section.votersCount ?? null }))
  const anchors = anchorsWithPlaces(loaded.anchors, counted)
  const plan = distributeSections({
    people: loaded.candidates,
    sections: counted,
    blocked,
    anchors,
    knownEmails: loaded.knownEmails,
    priority,
  })

  return { ok: true as const, plan, loaded, sections: counted, priority, blocked }
}

async function loadPriorityMap(db: Database) {
  const map = new Map<string, { r: number | null; level: string }>()
  try {
    const result = await db.prepare('SELECT section_code, r, level FROM priority_sections').all<{ section_code: string; r: number | null; level: string }>()
    for (const row of result.results ?? []) {
      map.set(row.section_code, { r: row.r === null || row.r === undefined ? null : Number(row.r), level: row.level ?? '' })
    }
  } catch {
    // No priority table yet: distribute as before.
  }
  return map
}

interface SignupRow {
  id: string
  email: string
  role: string
  mir: string
  region_code: string
  city_region_code: string
  place: string
  radius: string
  extra_city_regions: string
  distant_region_codes: string
  travel_municipalities: string
  draft_section: string
  draft_locked: number
  published_section: string
  payload: string
}

async function loadPeople(db: Database, keepDrafts: boolean) {
  const signups = await db
    .prepare(
      `SELECT id, email,
        COALESCE(role, '') AS role,
        COALESCE(mir_code, '') AS mir,
        COALESCE(region_code, '') AS region_code,
        COALESCE(city_region_code, '') AS city_region_code,
        COALESCE(section_place, '') AS place,
        COALESCE(radius, '') AS radius,
        COALESCE(extra_city_regions, '[]') AS extra_city_regions,
        COALESCE(distant_region_codes, '[]') AS distant_region_codes,
        COALESCE(travel_municipalities, '[]') AS travel_municipalities,
        COALESCE(draft_section, '') AS draft_section,
        COALESCE(draft_locked, 0) AS draft_locked,
        COALESCE(published_section, '') AS published_section,
        payload
      FROM signups
      WHERE COALESCE(submitted, 0) = 1 AND COALESCE(withdrawn, 0) = 0`,
    )
    .all<SignupRow>()
  const companions = await db
    .prepare(
      `SELECT c.signup_id, c.email, c.in_group, c.same_place, COALESCE(c.role, '') AS role
       FROM companions c
       JOIN signups s ON s.id = c.signup_id
       WHERE COALESCE(s.submitted, 0) = 1 AND COALESCE(s.withdrawn, 0) = 0`,
    )
    .all<{ signup_id: string; email: string; in_group: number; same_place: number; role: string }>()
  const bySignup = new Map<string, DistributeCompanion[]>()
  for (const row of companions.results ?? []) {
    const list = bySignup.get(row.signup_id) ?? []
    list.push({
      email: row.email,
      inGroup: row.in_group !== 0,
      samePlace: row.same_place !== 0,
      role: row.role || null,
      mobileTeam: false,
    })
    bySignup.set(row.signup_id, list)
  }

  const candidates: DistributePerson[] = []
  const anchors: Array<DistributeAnchor & { sectionId: string }> = []
  const knownEmails: string[] = []
  let kept = 0
  for (const row of signups.results ?? []) {
    const profile = readPayload(row.payload)
    const email = row.email.trim().toLowerCase()
    knownEmails.push(email)
    const group = (bySignup.get(row.id) ?? []).map((companion) => ({
      ...companion,
      mobileTeam: profile.companionMobile.get(companion.email.trim().toLowerCase()) === true,
    }))
    const hold = distributionHold({
      draftSection: row.draft_section,
      publishedSection: row.published_section,
      locked: row.draft_locked === 1 || (keepDrafts && normalizeSection(row.draft_section) !== ''),
    })
    if (hold !== 'rewrite') {
      if (hold === 'correction') kept += 1
      anchors.push({
        email,
        place: '',
        townId: null,
        sectionId: normalizeSection(row.published_section || row.draft_section),
        companionEmails: group.filter((companion) => companion.inGroup && companion.samePlace).map((companion) => companion.email),
      })
      continue
    }
    const extra = codesFrom(row.extra_city_regions)
    candidates.push({
      id: row.id,
      email,
      role: row.role,
      mobileTeam: profile.mobileTeam,
      radius: row.radius || profile.radius,
      mir: row.mir,
      regionCode: row.region_code,
      townId: profile.townId,
      municipalityCode: profile.municipalityCode,
      cityRegionCode: row.city_region_code || profile.cityRegionCode,
      extraCityRegionCodes: extra.length ? extra : profile.extraCityRegionCodes,
      distantMirs: mirList(row.distant_region_codes),
      travelStops: stopList(row.travel_municipalities),
      place: row.place,
      companions: group,
    })
  }
  return { candidates, anchors, knownEmails, kept }
}

async function blockedSections(db: Database, keepDrafts: boolean) {
  const blocked = new Set<string>()
  const taken = await db.prepare('SELECT section_code FROM taken_sections').all<{ section_code: string }>()
  for (const row of taken.results ?? []) blocked.add(normalizeSection(row.section_code))
  // „И аз“ partner people: their draft or published section is theirs, whatever the mode.
  for (const code of await partnerHeldCodes(db)) blocked.add(code)
  const used = await db
    .prepare(
      `SELECT COALESCE(draft_section, '') AS draft_section,
              COALESCE(published_section, '') AS published_section,
              COALESCE(draft_locked, 0) AS draft_locked
       FROM signups
       WHERE COALESCE(withdrawn, 0) = 0
         AND (COALESCE(draft_section, '') != '' OR COALESCE(published_section, '') != '')`,
    )
    .all<{ draft_section: string; published_section: string; draft_locked: number }>()
  for (const code of heldSectionCodes(
    (used.results ?? []).map((row) => ({
      draftSection: row.draft_section,
      publishedSection: row.published_section,
      locked: row.draft_locked === 1 || keepDrafts,
    })),
  )) {
    blocked.add(code)
  }
  return [...blocked]
}

function anchorsWithPlaces(anchors: Array<DistributeAnchor & { sectionId: string }>, sections: DistributeSection[]) {
  const byId = new Map(sections.map((section) => [section.id, section]))
  return anchors.flatMap((anchor) => {
    const sectionId = anchor.sectionId ? normalizeSection(anchor.sectionId).replace(/\D/g, '') : ''
    const section = byId.get(sectionId)
    return [
      {
        email: anchor.email,
        place: section?.place ?? '',
        townId: section?.townId ?? null,
        companionEmails: anchor.companionEmails,
      },
    ]
  })
}

function readPayload(payload: string) {
  const empty = {
    mobileTeam: false,
    radius: '',
    townId: null as number | null,
    municipalityCode: '',
    cityRegionCode: '',
    extraCityRegionCodes: [] as string[],
    companionMobile: new Map<string, boolean>(),
  }
  try {
    const parsed = JSON.parse(payload) as {
      mobileTeam?: boolean
      radius?: string
      extraCityRegions?: Array<{ code?: string }>
      place?: { townId?: number; municipalityCode?: string; cityRegionCode?: string }
      companions?: Array<{ email?: string; mobileTeam?: boolean }>
    }
    const companionMobile = new Map<string, boolean>()
    for (const companion of parsed.companions ?? []) {
      const email = companion.email?.trim().toLowerCase()
      if (email) companionMobile.set(email, companion.mobileTeam === true)
    }
    return {
      mobileTeam: parsed.mobileTeam === true,
      radius: typeof parsed.radius === 'string' ? parsed.radius : '',
      townId: typeof parsed.place?.townId === 'number' ? parsed.place.townId : null,
      municipalityCode: parsed.place?.municipalityCode ?? '',
      cityRegionCode: parsed.place?.cityRegionCode ?? '',
      extraCityRegionCodes: (parsed.extraCityRegions ?? []).map((item) => item.code ?? '').filter(Boolean),
      companionMobile,
    }
  } catch {
    return empty
  }
}

function mirList(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  } catch {
    return []
  }
}

function stopList(raw: string) {
  try {
    const parsed = JSON.parse(raw) as Array<{ regionCode?: string; code?: string }>
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => ({ regionCode: item?.regionCode ?? '', code: item?.code ?? '' }))
      .filter((item) => item.regionCode && item.code)
  } catch {
    return []
  }
}

function codesFrom(raw: string) {
  try {
    const parsed = JSON.parse(raw) as Array<{ code?: string }>
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => item?.code ?? '').filter(Boolean)
  } catch {
    return []
  }
}

function mergeSections(sections: DistributeSection[]) {
  const byId = new Map<string, DistributeSection>()
  for (const section of sections) {
    if (!byId.has(section.id)) byId.set(section.id, section)
  }
  return [...byId.values()]
}

export async function fetchApiJson(path: string): Promise<unknown> {
  try {
    const response = await fetch(`${API}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(20_000) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index])
    }
  }
  if (items.length === 0) return results
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

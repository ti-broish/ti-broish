import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { normalizeSection } from './admin-csv'
import {
  describeDistribution,
  distributeSections,
  readPollingSections,
  readTownIds,
  relevantPrefixes,
  votersFromResults,
  type DistributeAnchor,
  type DistributeCompanion,
  type DistributePerson,
  type DistributeSection,
} from './distribute'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

const API = 'https://api.tibroish.bg'
const HEADERS = { Accept: 'application/json', 'Accept-Language': 'bg-BG' }

export const adminDistribute = createServerFn({ method: 'POST' })
  .handler(async () => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const loaded = await loadPeople(db)
    const blocked = await blockedSections(db)
    const townIds = new Set<number>()
    const municipalities = new Set<string>()
    for (const person of loaded.candidates) {
      if (person.townId != null) townIds.add(person.townId)
      if (person.radius === 'municipality' && person.municipalityCode && person.mir) {
        municipalities.add(`${person.mir.padStart(2, '0')}:${person.municipalityCode.padStart(2, '0')}`)
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
    })

    const now = new Date().toISOString()
    let drafted = 0
    let paper = 0
    for (const row of plan.assignments) {
      const result = await db
        .prepare(
          `UPDATE signups
           SET draft_section = ?, updated_at = ?
           WHERE id = ?
             AND COALESCE(draft_section, '') = ''
             AND COALESCE(published_section, '') = ''
             AND COALESCE(submitted, 0) = 1
             AND COALESCE(withdrawn, 0) = 0
             AND COALESCE(role, '') = 'section'`,
        )
        .bind(row.sectionId, now, row.personId)
        .run()
      if (!changed(result)) continue
      drafted += 1
      if (row.desk === 'paper') paper += 1
    }

    const skipped = (reason: string) => plan.skipped.filter((row) => row.reason === reason).length
    return {
      ok: true as const,
      message: describeDistribution({
        drafted,
        paper,
        mobile: skipped('mobile'),
        wide: skipped('wide'),
        abroad: skipped('abroad'),
        noPlace: skipped('no-place'),
        noSection: skipped('no-section'),
        keptAtAddress: plan.keptAtAddress,
      }),
    }
  })

async function gate(action: StaffAction): Promise<{ ok: true; db: Database; email: string; role: StaffRole } | Denial> {
  const db = await signupDatabase()
  if (!db) return { ok: false, state: 'nodb', email: '', message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{ email: string; email_confirmed: number }>()
  if (!session) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  if (!session.email_confirmed) return { ok: false, state: 'unconfirmed', email, message: 'Потвърди имейла, за да влезеш в екипа.' }
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role) return { ok: false, state: 'forbidden', email, message: 'Този имейл не е поканен в екипа.' }
  if (!roleAllows(role, action)) return { ok: false, state: 'forbidden', email, message: 'Тази роля няма това право.' }
  return { ok: true, db, email, role }
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
  draft_section: string
  published_section: string
  payload: string
}

async function loadPeople(db: Database) {
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
        COALESCE(draft_section, '') AS draft_section,
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
  for (const row of signups.results ?? []) {
    const profile = readPayload(row.payload)
    const email = row.email.trim().toLowerCase()
    knownEmails.push(email)
    const group = (bySignup.get(row.id) ?? []).map((companion) => ({
      ...companion,
      mobileTeam: profile.companionMobile.get(companion.email.trim().toLowerCase()) === true,
    }))
    const sectionId = normalizeSection(row.published_section || row.draft_section)
    if (sectionId) {
      anchors.push({
        email,
        place: '',
        townId: null,
        sectionId,
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
      place: row.place,
      companions: group,
    })
  }
  return { candidates, anchors, knownEmails }
}

async function blockedSections(db: Database) {
  const blocked = new Set<string>()
  const taken = await db.prepare('SELECT section_code FROM taken_sections').all<{ section_code: string }>()
  for (const row of taken.results ?? []) blocked.add(normalizeSection(row.section_code))
  const used = await db
    .prepare(
      `SELECT COALESCE(draft_section, '') AS draft_section, COALESCE(published_section, '') AS published_section
       FROM signups
       WHERE COALESCE(withdrawn, 0) = 0
         AND (COALESCE(draft_section, '') != '' OR COALESCE(published_section, '') != '')`,
    )
    .all<{ draft_section: string; published_section: string }>()
  for (const row of used.results ?? []) {
    if (row.draft_section) blocked.add(normalizeSection(row.draft_section))
    if (row.published_section) blocked.add(normalizeSection(row.published_section))
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

async function getJson(path: string) {
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

function changed(result: unknown) {
  if (!result || typeof result !== 'object') return true
  const changes = (result as { meta?: { changes?: unknown } }).meta?.changes
  return typeof changes === 'number' ? changes > 0 : true
}

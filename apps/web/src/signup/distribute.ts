import { normalizeSection } from './admin-csv'
import { normalizeAddress, sectionDesk } from './sections'
import { rKey } from './priority-sections'
import { isSpecialBulgariaSection } from './stationary-sections'
import { lastTurnout, sectionTier, type Turnout } from './section-tiers'

export type SkipReason = 'mobile' | 'video' | 'abroad' | 'no-place' | 'no-section'
export type Together = 'address' | 'town' | 'municipality' | 'region' | 'solo'

export interface DistributeCompanion {
  email: string
  inGroup: boolean
  samePlace: boolean
  role: string | null
  mobileTeam: boolean
}

export interface DistributePerson {
  id: string
  email: string
  role: string
  mobileTeam: boolean
  radius: string
  mir: string
  regionCode: string
  townId: number | null
  municipalityCode: string
  cityRegionCode: string
  extraCityRegionCodes: string[]
  distantMirs: string[]
  travelStops: Array<{ regionCode: string; code: string }>
  place: string
  companions: DistributeCompanion[]
}

export interface DistributeSection {
  id: string
  place: string
  townId: number | null
  votersCount?: number | null
  isMachine?: boolean | null
  isMobile?: boolean | null
  /** A domestic priority (risk-scored) section. Order: home town, then municipality, by R desc. */
  priority?: { r: number | null; level: string } | null
  /** Last election (CIK, April 2026): гласували and избиратели. Missing for sections new since then. */
  turnout?: Turnout | null
}

export interface DistributeAnchor {
  email: string
  place: string
  townId: number | null
  companionEmails: readonly string[]
}

export interface DraftAssignment {
  personId: string
  email: string
  sectionId: string
  place: string
  desk: 'paper' | 'machine' | 'unknown'
  together: Together
}

export interface DistributePlan {
  assignments: DraftAssignment[]
  skipped: Array<{ personId: string; email: string; reason: SkipReason }>
  keptAtAddress: number
}

const LOCAL_RADIUS = new Set(['cityRegion', 'nearby', 'settlement', 'municipality', 'region', 'distant'])

export function distributeSections(input: {
  people: DistributePerson[]
  sections: DistributeSection[]
  blocked?: readonly string[]
  anchors?: readonly DistributeAnchor[]
  knownEmails?: readonly string[]
  /** Priority sections by code. They win over ordinary ones in the person's town, then municipality. */
  priority?: ReadonlyMap<string, { r: number | null; level: string }>
  /** Last election turnout by section code. Defaults to the checked-in CIK data (section-tiers.ts). */
  turnout?: ReadonlyMap<string, Turnout>
}): DistributePlan {
  const turnout = input.turnout ?? lastTurnout()
  const sections = dedupeSections(input.sections).map((section) => ({
    ...section,
    priority: input.priority?.get(section.id) ?? section.priority ?? null,
    turnout: section.turnout ?? turnout.get(section.id) ?? null,
  }))
  const used = new Set((input.blocked ?? []).map(canon).filter(Boolean))
  const anchors = input.anchors ?? []
  const known = new Set((input.knownEmails ?? input.people.map((person) => person.email)).map(emailKey))
  for (const anchor of anchors) known.add(emailKey(anchor.email))
  const assignments: DraftAssignment[] = []
  const skipped: DistributePlan['skipped'] = []
  let keptAtAddress = 0

  const candidates: DistributePerson[] = []
  for (const person of input.people) {
    const reason = skipReason(person)
    if (reason) skipped.push({ personId: person.id, email: person.email, reason })
    else candidates.push(person)
  }

  const held = new Set<string>()
  const clusters = clusterPeople(candidates)
  clusters.sort((a, b) => {
    const radius = tightest(a) - tightest(b)
    if (radius !== 0) return radius
    const size = pendingEmails(b, known, held).length + b.length - (pendingEmails(a, known, held).length + a.length)
    if (size !== 0) return size
    return a[0].id.localeCompare(b[0].id)
  })

  for (const members of clusters) {
    const pending = pendingEmails(members, known, held)
    const preference = preferred(members, anchors)
    // One pass over the whole accepted reach (home and travel areas): tier order wins, closeness breaks ties.
    const placed = placeNear(members, sections, used, preference, pending.length)
    if (placed) {
      if (placed.reserved > 0) for (const email of pending) held.add(email)
      assignments.push(...placed.assignments)
      if (placed.together === 'address' && (members.length > 1 || placed.reserved > 0)) keptAtAddress += 1
      continue
    }
    for (const person of members) {
      const solo = placeNear([person], sections, used, preference, 0)
      if (solo) assignments.push(...solo.assignments.map((row) => ({ ...row, together: 'solo' as const })))
      else skipped.push({ personId: person.id, email: person.email, reason: 'no-section' })
    }
  }

  return { assignments, skipped, keptAtAddress }
}

export type DraftHold = 'published' | 'correction' | 'rewrite'

/** A published section stays. A draft saved with Запази stays. Every other draft can be replaced. */
export function distributionHold(input: { draftSection: string; publishedSection: string; locked: boolean }): DraftHold {
  if (normalizeSection(input.publishedSection)) return 'published'
  if (input.locked && normalizeSection(input.draftSection)) return 'correction'
  return 'rewrite'
}

/** Codes a rerun must not give to someone else: published sections, saved corrections, and a published person's pending draft. */
export function heldSectionCodes(
  rows: Array<{ draftSection: string; publishedSection: string; locked: boolean; withdrawn?: boolean }>,
) {
  const codes = new Set<string>()
  for (const row of rows) {
    if (row.withdrawn) continue
    const published = normalizeSection(row.publishedSection)
    const draft = normalizeSection(row.draftSection)
    if (published) codes.add(published)
    if (draft && (row.locked || published)) codes.add(draft)
  }
  return [...codes]
}

export function describeDistribution(input: {
  drafted: number
  paper: number
  mobile: number
  video: number
  abroad: number
  noPlace: number
  noSection: number
  keptAtAddress: number
  kept?: number
}) {
  const drafted =
    input.drafted === 1 && input.paper === 1
      ? 'Записахме 1 чернова в хартиена секция.'
      : input.drafted > 1 && input.paper === input.drafted
        ? `Записахме ${draftWord(input.drafted)} в хартиени секции.`
        : input.paper > 0 && input.paper < input.drafted
          ? `Записахме ${draftWord(input.drafted)}, от които ${input.paper} хартиени.`
          : `Записахме ${draftWord(input.drafted)}.`
  const later = [
    input.mobile ? countPhrase(input.mobile, 'мобилен', 'мобилни') : '',
    input.video ? countPhrase(input.video, 'на видеонаблюдение', 'на видеонаблюдение') : '',
    input.abroad ? `${input.abroad} извън страната` : '',
    input.noPlace ? `${input.noPlace} без избран град` : '',
  ].filter(Boolean)
  const sentences = [drafted]
  const kept = input.kept ?? 0
  if (kept === 1) sentences.push('Задържахме 1 корекция.')
  else if (kept > 1) sentences.push(`Задържахме ${kept} корекции.`)
  if (later.length) sentences.push(`За после остават ${later.join(', ')}.`)
  if (input.noSection) sentences.push(`Без свободна секция в обхвата: ${input.noSection}.`)
  if (input.keptAtAddress === 1) sentences.push('1 група е на един адрес.')
  else if (input.keptAtAddress > 1) sentences.push(`${input.keptAtAddress} групи са на един адрес.`)
  return sentences.join(' ')
}

/** Pending drafts, including ones kept with Запази. A published section is not a draft. */
export function describeClearedDrafts(count: number) {
  const kept = 'Ръчните чернови и публикуваните секции остават.'
  if (count <= 0) return `Няма автоматични чернови за изчистване. ${kept}`
  if (count === 1) return `Изчистихме 1 автоматична чернова. ${kept}`
  return `Изчистихме ${count} автоматични чернови. ${kept}`
}

/** The public section list omits voter counts. Results files include stats.voters per section. */
export function votersFromResults(payload: unknown) {
  const found = new Map<string, number>()
  walk(payload)
  return found

  function walk(node: unknown) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!node || typeof node !== 'object') return
    const record = node as { segment?: unknown; stats?: { voters?: unknown }; nodes?: unknown }
    const id = typeof record.segment === 'string' ? canon(record.segment) : ''
    const voters = record.stats?.voters
    if (id && typeof voters === 'number' && Number.isFinite(voters) && voters > 0) found.set(id, voters)
    if (record.nodes) walk(record.nodes)
  }
}

/**
 * Sections from a municipality results file (`results/<mir><municipality>.json`): town → address → section,
 * with the voter count. One request per municipality instead of one per town, so a volunteer who accepts
 * a whole oblast sees every section in it.
 */
export function readResultsSections(payload: unknown): DistributeSection[] {
  const sections: DistributeSection[] = []
  walk(payload, null, '')
  return sections

  function walk(node: unknown, townId: number | null, place: string) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, townId, place)
      return
    }
    if (!node || typeof node !== 'object') return
    const record = node as { type?: unknown; id?: unknown; name?: unknown; segment?: unknown; stats?: { voters?: unknown }; nodes?: unknown }
    const town = record.type === 'town' && typeof record.id === 'number' ? record.id : townId
    const where = record.type === 'address' && typeof record.name === 'string' ? record.name : place
    if (record.type === 'section') {
      const id = canon(String(record.segment ?? ''))
      const voters = record.stats?.voters
      if (id) {
        sections.push({
          id,
          place: where,
          townId: town,
          votersCount: typeof voters === 'number' && Number.isFinite(voters) && voters > 0 ? voters : null,
          isMachine: null,
          isMobile: isSpecialBulgariaSection(id) ? true : null,
        })
      }
      return
    }
    if (record.nodes) walk(record.nodes, town, where)
  }
}

/**
 * MIRs where a person may be drafted in any municipality: the home oblast of a region or distant volunteer
 * (a region volunteer's picked municipalities narrow it), and the travel MIRs with no municipality picked.
 */
export function wholeReachMirs(person: DistributePerson) {
  if (skipReason(person) !== null) return []
  if (person.radius !== 'region' && person.radius !== 'distant') return []
  const picked = new Set(person.travelStops.map((stop) => padMir(stop.regionCode)).filter(Boolean))
  const mirs = new Set<string>()
  for (const mir of oblastMirs(person)) if (person.radius === 'distant' || !picked.has(mir)) mirs.add(mir)
  if (person.radius === 'distant') {
    for (const code of person.distantMirs) {
      const mir = padMir(code)
      if (mir && !picked.has(mir)) mirs.add(mir)
    }
  }
  return [...mirs]
}

export function readTownIds(payload: unknown) {
  if (!Array.isArray(payload)) return []
  const ids: number[] = []
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    if (typeof id === 'number' && Number.isFinite(id)) ids.push(id)
  }
  return ids
}

export function readPollingSections(payload: unknown, fallbackTownId: number): DistributeSection[] {
  if (!Array.isArray(payload)) return []
  const sections: DistributeSection[] = []
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue
    const row = item as {
      id?: unknown
      place?: unknown
      town?: { id?: unknown }
      votersCount?: unknown
      voters_count?: unknown
      isMachine?: unknown
      is_machine?: unknown
      isMobile?: unknown
      is_mobile?: unknown
    }
    const id = canon(String(row.id ?? ''))
    if (!id) continue
    const townId = typeof row.town?.id === 'number' ? row.town.id : fallbackTownId
    sections.push({
      id,
      place: typeof row.place === 'string' ? row.place : '',
      townId,
      votersCount: numberOrNull(row.votersCount) ?? numberOrNull(row.voters_count),
      isMachine: boolOrNull(row.isMachine) ?? boolOrNull(row.is_machine),
      isMobile: isSpecialBulgariaSection(id) ? true : (boolOrNull(row.isMobile) ?? boolOrNull(row.is_mobile)),
    })
  }
  return sections
}

function placeNear(
  members: DistributePerson[],
  sections: DistributeSection[],
  used: Set<string>,
  preference: { places: Set<string>; towns: Set<number> },
  extra: number,
) {
  return (
    placeCluster(members, sections, used, preference, 'address', extra) ??
    (extra > 0 ? placeCluster(members, sections, used, preference, 'address', 0) : null) ??
    placeCluster(members, sections, used, preference, 'town', 0) ??
    placeCluster(members, sections, used, preference, 'municipality', 0) ??
    placeCluster(members, sections, used, preference, 'region', 0)
  )
}

function placeCluster(
  members: DistributePerson[],
  sections: DistributeSection[],
  used: Set<string>,
  preference: { places: Set<string>; towns: Set<number> },
  level: Exclude<Together, 'solo'>,
  extra: number,
): { assignments: DraftAssignment[]; together: Together; reserved: number } | null {
  const pools = members.map((person) => allowedSections(person, sections, used))
  if (pools.some((pool) => pool.length === 0)) return null
  const keys = new Set<string>()
  for (const pool of pools) {
    for (const section of pool) {
      const key = bucketKey(section, level)
      if (key) keys.add(key)
    }
  }
  const place = members.map((person) => person.place).join(' ')
  const viable: Array<{
    key: string
    pools: DistributeSection[][]
    /** The bucket's best seats in draft order, one key per seat (see sectionKey). */
    seats: number[][]
    desks: number[]
    nearPlace: boolean
    paper: number
    weight: number
    preferred: boolean
  }> = []
  for (const key of keys) {
    const narrowed = pools.map((pool) => pool.filter((section) => bucketKey(section, level) === key && draftable(section)))
    if (narrowed.some((pool) => pool.length === 0)) continue
    const union = dedupeSections(narrowed.flat())
    if (union.length < members.length + extra) continue
    if (!assignDistinct(members, narrowed)) continue
    const best = [...union].sort((a, b) => compareSections(a, b, place, members)).slice(0, members.length + extra)
    viable.push({
      key,
      pools: narrowed,
      seats: best.map((section) => sectionKey(section, members)),
      desks: best.map((section) => deskRank(deskOf(section))),
      nearPlace: level === 'address' && members.some((person) => placeClose(person.place, key)),
      paper: union.filter((section) => deskOf(section) === 'paper').length,
      weight: best.reduce((max, section) => Math.max(max, tierOf(section).weight), 0),
      // Joining companions who already have a section beats a priority section elsewhere.
      preferred: (level === 'address' && preference.places.has(key)) || (level === 'town' && preference.towns.has(Number(key.slice('town:'.length)))),
    })
  }
  // Companions first. Then the best seats: priority in the home town, the tier (paper > 50, machine > 50,
  // paper ≤ 50, machine ≤ 50) across the whole reach, priority in the home municipality, closeness
  // (home town, municipality, МИР, oblast, travel areas). Then paper over unknown, the home address, size.
  viable.sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      compareKeyLists(a.seats, b.seats) ||
      compareKeyLists([a.desks], [b.desks]) ||
      Number(b.nearPlace) - Number(a.nearPlace) ||
      b.paper - a.paper ||
      b.weight - a.weight ||
      a.key.localeCompare(b.key, 'bg'),
  )
  const chosen = viable[0]
  if (!chosen) return null
  const assigned = assignDistinct(members, chosen.pools)
  if (!assigned) return null
  const taken = new Set(assigned.map((row) => row.sectionId))
  let reserved = 0
  if (extra > 0) {
    const rest = dedupeSections(chosen.pools.flat())
      .filter((section) => !taken.has(section.id))
      .sort((a, b) => compareSections(a, b, members.map((person) => person.place).join(' '), members))
    for (const section of rest) {
      if (reserved >= extra) break
      used.add(section.id)
      reserved += 1
    }
  }
  for (const row of assigned) used.add(row.sectionId)
  const together = members.length > 1 || reserved > 0 ? level : 'solo'
  return {
    assignments: assigned.map((row) => ({ ...row, together })),
    together,
    reserved,
  }
}

function assignDistinct(members: DistributePerson[], pools: DistributeSection[][]): DraftAssignment[] | null {
  const order = members
    .map((person, index) => ({ person, index, options: pools[index]?.length ?? 0 }))
    .sort((a, b) => a.options - b.options || a.person.id.localeCompare(b.person.id))
  const taken = new Set<string>()
  const assigned: DraftAssignment[] = []
  for (const item of order) {
    const options = (pools[item.index] ?? []).filter((section) => !taken.has(section.id) && draftable(section))
    options.sort((a, b) => compareSections(a, b, item.person.place, [item.person]))
    const section = options[0]
    if (!section) return null
    taken.add(section.id)
    assigned.push({
      personId: item.person.id,
      email: item.person.email,
      sectionId: section.id,
      place: section.place,
      desk: deskOf(section),
      together: 'solo',
    })
  }
  return assigned
}

export function relevantPrefixes(people: DistributePerson[], sections: DistributeSection[]) {
  const candidates = people.filter((person) => skipReason(person) === null)
  const prefixes = new Set<string>()
  for (const section of dedupeSections(sections)) {
    if (!candidates.some((person) => sectionFits(person, section, 'home') || sectionFits(person, section, 'chosen'))) continue
    prefixes.add(resultsPrefix(section.id))
  }
  return [...prefixes]
}

/**
 * A city district is `results/<mir><municipality><district>.json`.
 * Sections with no city region use district `00`. That file 500s, because the
 * API looks up a city region that does not exist. The municipality file
 * `results/<mir><municipality>.json` still lists each of those sections with
 * its voter count.
 */
function resultsPrefix(sectionId: string) {
  if (sectionId.slice(4, 6) === '00') return sectionId.slice(0, 4)
  return sectionId.slice(0, 6)
}

/** Everything the person accepted: home (town, district, oblast) and, for a distant volunteer, the travel MIRs and municipalities. */
function allowedSections(person: DistributePerson, sections: DistributeSection[], used: Set<string>) {
  return sections.filter((section) => !used.has(section.id) && (sectionFits(person, section, 'home') || sectionFits(person, section, 'chosen')))
}

function sectionFits(person: DistributePerson, section: DistributeSection, reach: 'home' | 'chosen') {
  if (section.isMobile === true) return false
  const parts = sectionParts(section.id)
  const mirs = mirsFor(person, reach)
  if (!parts || !mirs.has(parts.mir)) return false
  const municipality = pad2(person.municipalityCode)
  if (person.radius === 'municipality' && municipality) {
    if (parts.municipality !== municipality) return false
  } else if (person.radius !== 'region' && person.radius !== 'distant' && (section.townId == null || person.townId == null || section.townId !== person.townId)) {
    return false
  }
  if (restrictsMunicipalities(person, reach) && !municipalityAllowed(person, parts.mir, parts.municipality)) return false
  const districts = allowedDistricts(person)
  if (districts && !districts.has(parts.district)) return false
  return true
}

/** Picked municipalities limit that MIR. An oblast with none stays whole. Home for a distant volunteer ignores them. */
function restrictsMunicipalities(person: DistributePerson, reach: 'home' | 'chosen') {
  if (person.radius === 'region') return true
  return person.radius === 'distant' && reach === 'chosen'
}

function municipalityAllowed(person: DistributePerson, mir: string, municipality: string) {
  const allowed = new Set<string>()
  for (const stop of person.travelStops) {
    if (padMir(stop.regionCode) !== mir) continue
    const code = pad2(stop.code)
    if (code) allowed.add(code)
  }
  return allowed.size === 0 || allowed.has(municipality)
}

function mirsFor(person: DistributePerson, reach: 'home' | 'chosen') {
  const mirs = person.radius === 'region' || person.radius === 'distant' ? oblastMirs(person) : new Set([padMir(person.mir)].filter(Boolean))
  if (reach === 'chosen' && person.radius === 'distant') {
    for (const code of person.distantMirs) {
      const mir = padMir(code)
      if (mir) mirs.add(mir)
    }
    // A municipality they named counts as a chosen MIR even if the MIR itself was not ticked.
    for (const stop of person.travelStops) {
      const mir = padMir(stop.regionCode)
      if (mir) mirs.add(mir)
    }
  }
  return mirs
}

function oblastMirs(person: DistributePerson) {
  if (person.regionCode === 'sofia-merged') return new Set(['23', '24', '25'])
  const codes = new Set<string>()
  const region = padMir(person.regionCode)
  const mir = padMir(person.mir)
  if (region) codes.add(region)
  if (mir) codes.add(mir)
  return codes
}

function allowedDistricts(person: DistributePerson) {
  if (person.radius === 'settlement' || person.radius === 'municipality' || person.radius === 'region' || person.radius === 'distant') return null
  const home = pad2(person.cityRegionCode)
  if (!home) return null
  const districts = new Set([home])
  if (person.radius === 'nearby') {
    for (const code of person.extraCityRegionCodes) {
      const district = pad2(code)
      if (district) districts.add(district)
    }
  }
  return districts
}

function bucketKey(section: DistributeSection, level: Exclude<Together, 'solo'>) {
  if (level === 'address') return placeKey(section.place)
  if (level === 'town') return section.townId == null ? '' : `town:${section.townId}`
  const parts = sectionParts(section.id)
  if (!parts) return ''
  if (level === 'region') return `region:${parts.mir}`
  return `mir:${parts.mir}:muni:${parts.municipality}`
}

/** R desc; a blank R (quarantine) sorts after every scored section but still beats no priority section. */
function priorityR(section: DistributeSection) {
  const r = rKey(section.priority?.r)
  return Number.isFinite(r) ? r : -1e9
}

/**
 * How close a section is to the person: 0 their own town (in Sofia, Plovdiv and Varna their own район),
 * 1 elsewhere in their town, 2 their municipality, 3 their МИР, 4 their oblast, 5 a travel area.
 */
export function closeness(person: DistributePerson, section: DistributeSection) {
  const parts = sectionParts(section.id)
  if (!parts) return 9
  if (section.townId != null && person.townId != null && section.townId === person.townId) return ownDistrict(person, parts.district) ? 0 : 1
  const mir = padMir(person.mir)
  const municipality = pad2(person.municipalityCode)
  if (parts.mir === mir && municipality && parts.municipality === municipality) return 2
  if (parts.mir === mir) return 3
  if (oblastMirs(person).has(parts.mir)) return 4
  return 5
}

function ownDistrict(person: DistributePerson, district: string) {
  if (district === '00') return true
  const home = pad2(person.cityRegionCode)
  if (!home || district === home) return true
  return person.radius === 'nearby' && person.extraCityRegionCodes.some((code) => pad2(code) === district)
}

function groupCloseness(section: DistributeSection, people: readonly DistributePerson[]) {
  if (people.length === 0) return 0
  return Math.max(...people.map((person) => closeness(person, section)))
}

/**
 * 0: priority in a member's own town (own район in a city split into районы): it comes before any tier.
 * 1: priority elsewhere in their town or municipality: first inside its tier.
 * 2: priority further away (another МИР, oblast or travel area): after closer sections of its tier.
 * 3: not a priority section.
 */
function priorityScope(section: DistributeSection, people: readonly DistributePerson[]) {
  if (!section.priority) return 3
  let best = 2
  for (const person of people) {
    const near = closeness(person, section)
    if (near === 0) return 0
    if (near <= 2) best = 1
  }
  return best
}

/** Smaller is better. Compared lexicographically. */
function sectionKey(section: DistributeSection, people: readonly DistributePerson[]) {
  const scope = priorityScope(section, people)
  const r = scope < 3 ? -priorityR(section) : 0
  return [
    scope === 0 ? 0 : 1,
    scope === 0 ? r : 0,
    tierOf(section).rank,
    scope === 1 ? 0 : 1,
    scope === 1 ? r : 0,
    groupCloseness(section, people),
    scope === 2 ? 0 : 1,
    scope === 2 ? r : 0,
  ]
}

function compareKeys(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** A bucket with more seats wins over one with fewer; otherwise seat by seat. */
function compareKeyLists(a: readonly (readonly number[])[], b: readonly (readonly number[])[]) {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const d = compareKeys(a[i]!, b[i]!)
    if (d !== 0) return d
  }
  return b.length - a.length
}

function compareSections(a: DistributeSection, b: DistributeSection, place: string, people: readonly DistributePerson[] = []) {
  // Priority in the home town, then the tier across the whole reach, then closeness (sectionKey).
  const keys = compareKeys(sectionKey(a, people), sectionKey(b, people))
  if (keys !== 0) return keys
  const tierA = tierOf(a)
  const tierB = tierOf(b)
  const placeRank = (section: DistributeSection) => (placeClose(place, placeKey(section.place)) ? 0 : 1)
  if (tierA.tier === 3 || tierA.tier === 4) {
    if (tierA.weight !== tierB.weight) return tierB.weight - tierA.weight
    const places = placeRank(a) - placeRank(b)
    if (places !== 0) return places
  } else {
    const places = placeRank(a) - placeRank(b)
    if (places !== 0) return places
    if (tierA.weight !== tierB.weight) return tierB.weight - tierA.weight
  }
  const desk = deskRank(deskOf(a)) - deskRank(deskOf(b))
  if (desk !== 0) return desk
  return a.id.localeCompare(b.id)
}

function clusterPeople(people: DistributePerson[]) {
  const byEmail = new Map(people.map((person) => [emailKey(person.email), person]))
  const parent = new Map(people.map((person) => [person.id, person.id]))
  const find = (id: string): string => {
    const next = parent.get(id) ?? id
    if (next === id) return id
    const root = find(next)
    parent.set(id, root)
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }
  for (const person of people) {
    for (const companion of person.companions) {
      if (!companion.inGroup || !companion.samePlace || mobileCompanion(companion)) continue
      const other = byEmail.get(emailKey(companion.email))
      if (other && other.id !== person.id) union(person.id, other.id)
    }
  }
  const groups = new Map<string, DistributePerson[]>()
  for (const person of people) {
    const root = find(person.id)
    const list = groups.get(root) ?? []
    list.push(person)
    groups.set(root, list)
  }
  return [...groups.values()].map((group) => group.sort((a, b) => a.id.localeCompare(b.id)))
}

function pendingEmails(members: DistributePerson[], known: Set<string>, held: Set<string>) {
  const seen = new Set<string>()
  const emails: string[] = []
  for (const person of members) {
    for (const companion of person.companions) {
      if (!companion.inGroup || !companion.samePlace || mobileCompanion(companion)) continue
      const email = emailKey(companion.email)
      if (!email || known.has(email) || held.has(email) || seen.has(email)) continue
      seen.add(email)
      emails.push(email)
    }
  }
  return emails
}

function preferred(members: DistributePerson[], anchors: readonly DistributeAnchor[]) {
  const places = new Set<string>()
  const towns = new Set<number>()
  const memberEmails = new Set(members.map((person) => emailKey(person.email)))
  for (const anchor of anchors) {
    const anchorEmail = emailKey(anchor.email)
    const listed = members.some((person) =>
      person.companions.some((companion) => companion.inGroup && companion.samePlace && !mobileCompanion(companion) && emailKey(companion.email) === anchorEmail),
    )
    const listsMember = anchor.companionEmails.some((email) => memberEmails.has(emailKey(email)))
    if (!listed && !listsMember) continue
    const place = placeKey(anchor.place)
    if (place) places.add(place)
    if (anchor.townId != null) towns.add(anchor.townId)
  }
  return { places, towns }
}

function skipReason(person: DistributePerson): SkipReason | null {
  if (person.regionCode === '32' || padMir(person.mir) === '32') return 'abroad'
  if (person.mobileTeam || person.role === 'mobile') return 'mobile'
  if (person.role === 'video') return 'video'
  if (person.role !== 'section') return 'mobile'
  if (person.radius === 'distant') return oblastMirs(person).size || person.distantMirs.some((code) => padMir(code)) ? null : 'no-place'
  if (person.radius === 'region') return oblastMirs(person).size ? null : 'no-place'
  if (!LOCAL_RADIUS.has(person.radius) || !padMir(person.mir)) return 'no-place'
  if (person.radius === 'municipality') {
    if (!pad2(person.municipalityCode) && person.townId == null) return 'no-place'
    return null
  }
  if (person.townId == null) return 'no-place'
  return null
}

function tightest(members: DistributePerson[]) {
  return Math.min(...members.map((person) => radiusRank(person.radius)))
}

function radiusRank(radius: string) {
  if (radius === 'cityRegion') return 0
  if (radius === 'nearby') return 1
  if (radius === 'settlement') return 2
  if (radius === 'municipality') return 3
  if (radius === 'region') return 4
  if (radius === 'distant') return 5
  return 9
}

/**
 * Every section a person can reach can be drafted: paper, unknown and machine (tiers 2 and 4 cover all
 * machine sections, not only priority-list ones). Mobile, reserved and „И аз“ sections never reach here:
 * sectionFits drops mobile ones and `used` starts with the blocked codes.
 */
function draftable(_section: DistributeSection) {
  return true
}

export function tierOf(section: DistributeSection) {
  return sectionTier(deskOf(section), section.turnout)
}

function deskOf(section: DistributeSection) {
  return sectionDesk({ votersCount: knownCount(section), isMachine: section.isMachine })
}

function knownCount(section: DistributeSection) {
  const count = section.votersCount
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null
  return count
}

function deskRank(desk: 'paper' | 'machine' | 'unknown') {
  if (desk === 'paper') return 0
  if (desk === 'unknown') return 1
  return 2
}

function dedupeSections(sections: DistributeSection[]) {
  const byId = new Map<string, DistributeSection>()
  for (const section of sections) {
    const id = canon(section.id)
    if (!id || byId.has(id)) continue
    byId.set(id, { ...section, id })
  }
  return [...byId.values()]
}

function canon(id: string) {
  const normalized = normalizeSection(id).replace(/\D/g, '')
  if (normalized.length !== 9 || normalized.startsWith('32')) return ''
  return normalized
}

function sectionParts(id: string) {
  const digits = canon(id)
  if (!digits) return null
  return { id: digits, mir: digits.slice(0, 2), municipality: digits.slice(2, 4), district: digits.slice(4, 6) }
}

function placeKey(place: string) {
  return normalizeAddress(place).toLocaleLowerCase('bg')
}

function placeClose(wanted: string, addressKey: string) {
  const want = placeKey(wanted)
  if (want.length < 4 || !addressKey) return false
  return addressKey.includes(want) || want.includes(addressKey)
}

function padMir(value: string) {
  const trimmed = value.trim()
  if (!/^\d{1,2}$/.test(trimmed)) return ''
  return trimmed.padStart(2, '0')
}

function pad2(value: string) {
  const digits = value.trim()
  if (!/^\d{1,2}$/.test(digits)) return ''
  return digits.padStart(2, '0')
}

function emailKey(email: string) {
  return email.trim().toLowerCase()
}

function mobileCompanion(companion: DistributeCompanion) {
  return companion.mobileTeam || companion.role === 'mobile' || companion.role === 'video'
}

function draftWord(count: number) {
  return count === 1 ? '1 чернова' : `${count} чернови`
}

function countPhrase(count: number, one: string, many: string) {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boolOrNull(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

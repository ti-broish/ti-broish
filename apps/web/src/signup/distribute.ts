import { normalizeSection } from './admin-csv'
import { normalizeAddress, sectionDesk } from './sections'

export type SkipReason = 'mobile' | 'wide' | 'abroad' | 'no-place' | 'no-section'
export type Together = 'address' | 'town' | 'municipality' | 'solo'

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

const LOCAL_RADIUS = new Set(['cityRegion', 'nearby', 'settlement', 'municipality'])

export function distributeSections(input: {
  people: DistributePerson[]
  sections: DistributeSection[]
  blocked?: readonly string[]
  anchors?: readonly DistributeAnchor[]
  knownEmails?: readonly string[]
}): DistributePlan {
  const sections = dedupeSections(input.sections)
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
    const placed =
      placeCluster(members, sections, used, preference, 'address', pending.length) ??
      placeCluster(members, sections, used, preference, 'address', 0) ??
      placeCluster(members, sections, used, preference, 'town', 0) ??
      placeCluster(members, sections, used, preference, 'municipality', 0)
    if (placed) {
      if (placed.reserved > 0) for (const email of pending) held.add(email)
      assignments.push(...placed.assignments)
      if (placed.together === 'address' && (members.length > 1 || placed.reserved > 0)) keptAtAddress += 1
      continue
    }
    for (const person of members) {
      const solo = placeCluster([person], sections, used, preference, 'address', 0)
      if (solo) assignments.push(...solo.assignments.map((row) => ({ ...row, together: 'solo' as const })))
      else skipped.push({ personId: person.id, email: person.email, reason: 'no-section' })
    }
  }

  return { assignments, skipped, keptAtAddress }
}

export function describeDistribution(input: {
  drafted: number
  paper: number
  mobile: number
  wide: number
  abroad: number
  noPlace: number
  noSection: number
  keptAtAddress: number
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
    input.mobile ? `${input.mobile} мобилни` : '',
    input.wide ? `${input.wide} с обхват област или по-далеч` : '',
    input.abroad ? `${input.abroad} извън страната` : '',
    input.noPlace ? `${input.noPlace} без избран град` : '',
  ].filter(Boolean)
  const sentences = [drafted]
  if (later.length) sentences.push(`За после остават ${later.join(', ')}.`)
  if (input.noSection) sentences.push(`Без свободна хартиена секция в обхвата: ${input.noSection}.`)
  if (input.keptAtAddress === 1) sentences.push('1 група е на един адрес.')
  else if (input.keptAtAddress > 1) sentences.push(`${input.keptAtAddress} групи са на един адрес.`)
  return sentences.join(' ')
}

/** The public section list omits voter counts. District results include stats.voters per section. */
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
      isMobile: boolOrNull(row.isMobile) ?? boolOrNull(row.is_mobile),
    })
  }
  return sections
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
  const viable: Array<{ key: string; score: number; pools: DistributeSection[][] }> = []
  for (const key of keys) {
    const narrowed = pools.map((pool) => pool.filter((section) => bucketKey(section, level) === key && deskOf(section) !== 'machine'))
    if (narrowed.some((pool) => pool.length === 0)) continue
    const union = dedupeSections(narrowed.flat())
    if (union.length < members.length + extra) continue
    if (!assignDistinct(members, narrowed)) continue
    viable.push({ key, score: bucketScore(key, union, members, preference, level, members.length + extra), pools: narrowed })
  }
  viable.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key, 'bg'))
  const chosen = viable[0]
  if (!chosen) return null
  const assigned = assignDistinct(members, chosen.pools)
  if (!assigned) return null
  const taken = new Set(assigned.map((row) => row.sectionId))
  let reserved = 0
  if (extra > 0) {
    const rest = dedupeSections(chosen.pools.flat())
      .filter((section) => !taken.has(section.id))
      .sort((a, b) => compareSections(a, b, members.map((person) => person.place).join(' ')))
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
    const options = (pools[item.index] ?? []).filter((section) => !taken.has(section.id) && deskOf(section) !== 'machine')
    options.sort((a, b) => compareSections(a, b, item.person.place))
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
    if (!candidates.some((person) => sectionFits(person, section))) continue
    prefixes.add(section.id.slice(0, 6))
  }
  return [...prefixes]
}

function allowedSections(person: DistributePerson, sections: DistributeSection[], used: Set<string>) {
  return sections.filter((section) => !used.has(section.id) && sectionFits(person, section))
}

function sectionFits(person: DistributePerson, section: DistributeSection) {
  if (section.isMobile === true) return false
  const parts = sectionParts(section.id)
  const mir = padMir(person.mir)
  if (!parts || !mir || parts.mir !== mir) return false
  const municipality = pad2(person.municipalityCode)
  if (person.radius === 'municipality' && municipality) {
    if (parts.municipality !== municipality) return false
  } else if (section.townId == null || person.townId == null || section.townId !== person.townId) {
    return false
  }
  const districts = allowedDistricts(person)
  if (districts && !districts.has(parts.district)) return false
  return true
}

function allowedDistricts(person: DistributePerson) {
  if (person.radius === 'settlement' || person.radius === 'municipality') return null
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
  return parts ? `mir:${parts.mir}:muni:${parts.municipality}` : ''
}

function bucketScore(
  key: string,
  sections: DistributeSection[],
  members: DistributePerson[],
  preference: { places: Set<string>; towns: Set<number> },
  level: Exclude<Together, 'solo'>,
  seats: number,
) {
  const paper = sections.filter((section) => deskOf(section) === 'paper').length
  const unknown = sections.filter((section) => deskOf(section) === 'unknown').length
  // One paper seat outranks any number of sections whose voter count we do not know.
  const paperFit = Math.min(paper, seats)
  const unknownFit = Math.min(unknown, Math.max(0, seats - paper))
  let score = paperFit * 1_000_000 + unknownFit * 1_000 + paper
  if (level === 'address' && preference.places.has(key)) score += 5_000
  if (level === 'address' && members.some((person) => placeClose(person.place, key))) score += 500
  if (level === 'town') {
    const townId = Number(key.slice('town:'.length))
    if (preference.towns.has(townId)) score += 5_000
  }
  return score
}

function compareSections(a: DistributeSection, b: DistributeSection, place: string) {
  const desk = deskRank(deskOf(a)) - deskRank(deskOf(b))
  if (desk !== 0) return desk
  const placeRank = (section: DistributeSection) => (placeClose(place, placeKey(section.place)) ? 0 : 1)
  const places = placeRank(a) - placeRank(b)
  if (places !== 0) return places
  const voters = (knownCount(a) ?? 99999) - (knownCount(b) ?? 99999)
  if (voters !== 0) return voters
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
  if (person.role !== 'section' || person.mobileTeam) return 'mobile'
  if (person.radius === 'region' || person.radius === 'distant') return 'wide'
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
  return 9
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

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boolOrNull(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

import { foldPlace, rKey } from './priority-sections'

/**
 * Mobile teams. A mobile team does not sit in one section: it gets an AREA (a МИР and a
 * municipality, or a town / city district when that is all the person can reach) and a short
 * list of TARGET priority sections there that have no section person yet, highest R first.
 * Pure: no DB, no mail. Writing drafts lives in mobile-teams-admin.ts.
 */

export interface MobilePerson {
  id: string
  email: string
  mir: string
  regionCode: string
  radius: string
  townName: string
  municipalityCode: string
  cityRegionCode: string
  extraCityRegionCodes: string[]
  distantMirs: string[]
  travelStops: Array<{ regionCode: string; code: string }>
  hasCar: boolean | null
  carSeats: number
  hasDrone: boolean | null
  roundsFirst: boolean
  roundsRunoff: boolean
  companions: Array<{ email: string; inGroup: boolean; samePlace: boolean }>
}

export interface MobilePrioritySection {
  sectionCode: string
  town: string
  municipality: string
  r: number | null
  level: string
}

export interface MobileTarget {
  code: string
  r: number | null
  level: string
  town: string
}

export interface MobileArea {
  key: string
  mir: string
  municipality: string
  label: string
  scope: 'town' | 'district' | 'municipality'
  targets: MobileTarget[]
  score: number
}

export interface MobileDraft {
  personId: string
  teamKey: string
  area: MobileArea
}

export type MobileSkipReason = 'abroad' | 'no-place' | 'no-priority-in-reach' | 'no-days'

export interface MobilePlan {
  drafts: MobileDraft[]
  skipped: Array<{ personId: string; reason: MobileSkipReason }>
}

/** Targets per team: a car can cover a short route, on foot a few sections in one town. */
export function targetsPerTeam(members: Pick<MobilePerson, 'hasCar'>[]) {
  return members.some((person) => person.hasCar === true) ? 5 : 3
}

export function mobileSkipReason(person: MobilePerson): MobileSkipReason | null {
  if (padMir(person.mir) === '32' || person.regionCode === '32') return 'abroad'
  if (!person.roundsFirst && !person.roundsRunoff) return 'no-days'
  if (homeMirs(person).size === 0) return 'no-place'
  if (localOnly(person) && !foldPlace(person.townName)) return 'no-place'
  if (person.radius === 'municipality' && !pad2(person.municipalityCode)) return 'no-place'
  if (!['settlement', 'cityRegion', 'nearby', 'municipality', 'region', 'distant'].includes(person.radius)) return 'no-place'
  return null
}

/**
 * Where a person can go, from what they told us: the radius, their МИР (or the whole oblast for
 * region/distant, plus the distant МИРs they picked), the municipalities they listed, and transport.
 * Without a car, region/distant/municipality shrink to the home municipality.
 */
export function mobileReaches(person: MobilePerson, section: Pick<MobilePrioritySection, 'sectionCode' | 'town'>) {
  const code = section.sectionCode
  if (!/^\d{9}$/.test(code) || code.startsWith('32')) return false
  const mir = code.slice(0, 2)
  const municipality = code.slice(2, 4)
  const district = code.slice(4, 6)
  const home = padMir(person.mir)
  const homeMunicipality = pad2(person.municipalityCode)
  if (localOnly(person)) {
    if (mir !== home && !(person.regionCode === 'sofia-merged' && !home && ['23', '24', '25'].includes(mir))) return false
    if (foldPlace(section.town) !== foldPlace(person.townName)) return false
    if (person.radius === 'settlement') return true
    const districts = new Set([pad2(person.cityRegionCode), ...(person.radius === 'nearby' ? person.extraCityRegionCodes.map(pad2) : [])].filter(Boolean))
    return districts.size === 0 || districts.has(district)
  }
  if (person.radius === 'municipality' || person.hasCar !== true) {
    if (!homeMunicipality) return false
    const mirs = person.radius === 'municipality' ? new Set([home]) : homeMirs(person)
    return mirs.has(mir) && municipality === homeMunicipality
  }
  const mirs = homeMirs(person)
  if (person.radius === 'distant') for (const code of person.distantMirs) if (padMir(code)) mirs.add(padMir(code))
  if (!mirs.has(mir)) return false
  const listed = person.travelStops.filter((stop) => padMir(stop.regionCode) === mir).map((stop) => pad2(stop.code))
  return listed.length === 0 || listed.includes(municipality) || (mir === home && municipality === homeMunicipality)
}

/** Teams: mobile people who listed each other as a group at the same place. */
export function mobileTeams(people: MobilePerson[]) {
  const byEmail = new Map(people.map((person) => [person.email.trim().toLowerCase(), person]))
  const parent = new Map(people.map((person) => [person.id, person.id]))
  const find = (id: string): string => {
    const next = parent.get(id) ?? id
    if (next === id) return id
    const root = find(next)
    parent.set(id, root)
    return root
  }
  for (const person of people) {
    for (const companion of person.companions) {
      if (!companion.inGroup || !companion.samePlace) continue
      const other = byEmail.get(companion.email.trim().toLowerCase())
      if (other && other.id !== person.id) {
        const a = find(person.id)
        const b = find(other.id)
        if (a !== b) parent.set(b, a)
      }
    }
  }
  const teams = new Map<string, MobilePerson[]>()
  for (const person of people) {
    const root = find(person.id)
    teams.set(root, [...(teams.get(root) ?? []), person])
  }
  return [...teams.values()].map((members) => members.sort((a, b) => a.id.localeCompare(b.id)))
}

/** Areas a team can cover now, best first: the sum of R of the K best open targets, less for a МИР that already has teams. */
export function mobileAreas(
  members: MobilePerson[],
  open: MobilePrioritySection[],
  teamsPerMir: ReadonlyMap<string, number> = new Map(),
) {
  const k = targetsPerTeam(members)
  const local = members.every(localOnly)
  const buckets = new Map<string, MobilePrioritySection[]>()
  for (const section of open) {
    if (!members.every((person) => mobileReaches(person, section))) continue
    const key = areaKey(section, local)
    buckets.set(key, [...(buckets.get(key) ?? []), section])
  }
  const areas: MobileArea[] = []
  for (const [key, sections] of buckets) {
    const sorted = [...sections].sort(byRiskDesc)
    const picked = sorted.slice(0, k)
    const first = picked[0]
    const mir = first.sectionCode.slice(0, 2)
    const municipality = first.sectionCode.slice(2, 4)
    const sum = picked.reduce((total, section) => total + weight(section), 0)
    const score = sum / (1 + 0.5 * (teamsPerMir.get(mir) ?? 0))
    const scope: MobileArea['scope'] = isBigCity(mir, municipality) ? 'district' : local ? 'town' : 'municipality'
    areas.push({
      key,
      mir,
      municipality,
      label: areaLabel(first, scope, key),
      scope,
      targets: picked.map((section) => ({ code: section.sectionCode, r: section.r, level: section.level, town: section.town })),
      score,
    })
  }
  return areas.sort((a, b) => b.score - a.score || b.targets.length - a.targets.length || a.key.localeCompare(b.key))
}

/**
 * Every team gets one area and up to K targets. Teams with the fewest options go first so the
 * flexible ones fill the gaps; a section is a target for one team only; a МИР that already has a
 * team counts for less, which spreads teams out.
 */
export function planMobileTeams(input: {
  people: MobilePerson[]
  priority: MobilePrioritySection[]
  /** Codes with a section person (draft or published), reserved by other orgs, or targeted by another mobile draft. */
  unavailable: ReadonlySet<string>
  /** Teams already drafted per МИР, for balance. */
  teamsPerMir?: ReadonlyMap<string, number>
}): MobilePlan {
  const skipped: MobilePlan['skipped'] = []
  const ready: MobilePerson[] = []
  for (const person of input.people) {
    const reason = mobileSkipReason(person)
    if (reason) skipped.push({ personId: person.id, reason })
    else ready.push(person)
  }
  const used = new Set(input.unavailable)
  const perMir = new Map(input.teamsPerMir ?? [])
  const open = () => input.priority.filter((section) => !used.has(section.sectionCode))
  const teams = mobileTeams(ready)
    .map((members) => ({ members, options: mobileAreas(members, open()).length }))
    .sort((a, b) => a.options - b.options || a.members[0].id.localeCompare(b.members[0].id))
  const drafts: MobileDraft[] = []
  for (const team of teams) {
    const best = mobileAreas(team.members, open(), perMir)[0]
    if (!best) {
      for (const person of team.members) skipped.push({ personId: person.id, reason: 'no-priority-in-reach' })
      continue
    }
    for (const target of best.targets) used.add(target.code)
    perMir.set(best.mir, (perMir.get(best.mir) ?? 0) + 1)
    const teamKey = team.members[0].id
    for (const person of team.members) drafts.push({ personId: person.id, teamKey, area: best })
  }
  return { drafts, skipped }
}

export function describeMobilePlan(plan: MobilePlan) {
  const teams = new Set(plan.drafts.map((draft) => draft.teamKey)).size
  const targets = new Set(plan.drafts.flatMap((draft) => draft.area.targets.map((target) => target.code))).size
  const count = (reason: MobileSkipReason) => plan.skipped.filter((row) => row.reason === reason).length
  const parts = [`Чернови за ${plan.drafts.length} души в ${teams} екипа, ${targets} приоритетни секции.`]
  const later = [
    count('no-priority-in-reach') ? `${count('no-priority-in-reach')} без непокрита приоритетна секция в обхвата` : '',
    count('no-place') ? `${count('no-place')} без МИР или населено място` : '',
    count('no-days') ? `${count('no-days')} без избран ден` : '',
    count('abroad') ? `${count('abroad')} извън страната` : '',
  ].filter(Boolean)
  if (later.length) parts.push(`Без чернова: ${later.join(', ')}.`)
  return parts.join(' ')
}

export function mobileRoundsLabel(person: Pick<MobilePerson, 'roundsFirst' | 'roundsRunoff'>) {
  if (person.roundsFirst && person.roundsRunoff) return 'двата тура'
  if (person.roundsFirst) return 'само 1-ви тур'
  if (person.roundsRunoff) return 'само балотаж'
  return 'без ден'
}

function localOnly(person: Pick<MobilePerson, 'radius'>) {
  return person.radius === 'settlement' || person.radius === 'cityRegion' || person.radius === 'nearby'
}

function homeMirs(person: Pick<MobilePerson, 'mir' | 'regionCode' | 'radius'>) {
  const mirs = new Set<string>()
  if (person.radius === 'region' || person.radius === 'distant') {
    if (person.regionCode === 'sofia-merged') for (const code of ['23', '24', '25']) mirs.add(code)
    else if (padMir(person.regionCode) && padMir(person.regionCode) !== '32') mirs.add(padMir(person.regionCode))
  }
  if (padMir(person.mir) && padMir(person.mir) !== '32') mirs.add(padMir(person.mir))
  if (person.regionCode === 'sofia-merged' && mirs.size === 0 && localOnly(person as MobilePerson)) {
    // Sofia city without a МИР: the town still pins it down to МИР 23–25.
    for (const code of ['23', '24', '25']) mirs.add(code)
  }
  return mirs
}

function areaKey(section: MobilePrioritySection, local: boolean) {
  const mir = section.sectionCode.slice(0, 2)
  const municipality = section.sectionCode.slice(2, 4)
  if (isBigCity(mir, municipality)) return `${mir}:${municipality}:${section.sectionCode.slice(4, 6)}`
  if (local) return `${mir}:${municipality}:${foldPlace(section.town)}`
  return `${mir}:${municipality}`
}

/** Cities split into districts in the section code (Sofia, Plovdiv, Varna): one district is a day's route. */
function isBigCity(mir: string, municipality: string) {
  return (['23', '24', '25'].includes(mir) && municipality === '46') || (mir === '16' && municipality === '22') || (mir === '03' && municipality === '06')
}

function areaLabel(section: MobilePrioritySection, scope: MobileArea['scope'], key: string) {
  const mir = section.sectionCode.slice(0, 2)
  const parts = key.split(':')
  if (scope === 'district') return `МИР ${mir} · ${section.town || section.municipality}, район ${parts[2]}`
  if (scope === 'town') return `МИР ${mir} · ${section.town}`
  return `МИР ${mir} · община ${section.municipality}`
}

function byRiskDesc(a: MobilePrioritySection, b: MobilePrioritySection) {
  const r = weight(b) - weight(a)
  return r !== 0 ? r : a.sectionCode.localeCompare(b.sectionCode)
}

/** R, or a small positive weight for a blank R (quarantine) so it still counts. */
function weight(section: Pick<MobilePrioritySection, 'r'>) {
  const r = rKey(section.r)
  return Number.isFinite(r) ? r : 0.5
}

function padMir(value: string) {
  const trimmed = (value ?? '').trim()
  return /^\d{1,2}$/.test(trimmed) ? trimmed.padStart(2, '0') : ''
}

function pad2(value: string) {
  const trimmed = (value ?? '').trim()
  return /^\d{1,2}$/.test(trimmed) ? trimmed.padStart(2, '0') : ''
}

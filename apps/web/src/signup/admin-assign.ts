import { mirFromSection, normalizeSection } from './admin-csv'
import { sectionDesk } from './sections'

export type AssignWarningCode = 'taken' | 'duplicate' | 'mir_mismatch' | 'outside_places'

export interface AssignWarning {
  code: AssignWarningCode
  /** `block` stops publish; draft save still keeps the value but surfaces the message. */
  level: 'warn' | 'block'
  message: string
}

export interface DuplicateOwner {
  id: string
  email: string
  kind: 'draft' | 'published'
}

export interface SectionCandidate {
  id: string
  place: string
  score: number
  reason: string
  desk: 'paper' | 'machine' | 'unknown'
}

export interface SuggestPerson {
  /** When set, sections in any accepted MIR are offered, not just the home MIR. */
  reach?: PersonReach
  mir: string
  town: string
  municipality: string
  place: string
  radius: string
  travelMunicipalities: string
}

/** Where a volunteer said they can go: what the signup stores and the allocator reads. */
export interface PersonReach {
  mir: string
  region: string
  radius: string
  /** MIRs picked under „мога да пътувам“ (distant_region_codes). */
  distantMirs: string[]
  /** Municipalities picked (travel_municipalities): MIR and municipality code, with the name for messages. */
  travelStops: Array<{ mir: string; municipality: string; name: string }>
}

/** SELECT columns for personReachFrom; prefix with a table alias if needed. */
export const PERSON_REACH_COLUMNS = `COALESCE(mir_code, '') AS mir, COALESCE(region_code, '') AS region, COALESCE(radius, '') AS radius,
  COALESCE(distant_region_codes, '[]') AS distant_region_codes, COALESCE(travel_municipalities, '[]') AS travel_municipalities`

export function personReachFrom(row: { mir?: string | null; region?: string | null; radius?: string | null; distant_region_codes?: string | null; travel_municipalities?: string | null }): PersonReach {
  const distantMirs = parseJsonArray(row.distant_region_codes).filter((item): item is string => typeof item === 'string').map(padMir).filter(Boolean)
  const travelStops = parseJsonArray(row.travel_municipalities).flatMap((item) => {
    const stop = item as { regionCode?: unknown; code?: unknown; name?: unknown } | null
    const mir = padMir(String(stop?.regionCode ?? ''))
    const municipality = padMir(String(stop?.code ?? ''))
    return mir && municipality ? [{ mir, municipality, name: String(stop?.name ?? '').trim() }] : []
  })
  return { mir: row.mir ?? '', region: row.region ?? '', radius: row.radius ?? '', distantMirs, travelStops }
}

/**
 * MIRs the person accepts, the same way the allocator reads it: their own MIR; the whole oblast for
 * „в областта“ / „мога да пътувам“ (София is 23, 24 and 25); the MIRs picked to travel to; and the MIR
 * of every municipality they named.
 */
export function acceptedMirs(reach: PersonReach) {
  const mirs = new Set<string>()
  const own = padMir(reach.mir)
  if (own) mirs.add(own)
  const wide = reach.radius === 'region' || reach.radius === 'distant'
  if (wide) {
    if (reach.region === 'sofia-merged') for (const mir of ['23', '24', '25']) mirs.add(mir)
    const region = padMir(reach.region)
    if (region) mirs.add(region)
  }
  if (reach.radius === 'distant') for (const mir of reach.distantMirs) mirs.add(mir)
  for (const stop of reach.travelStops) mirs.add(stop.mir)
  return mirs
}

/**
 * Does the section sit inside the places the person accepts? 'mir' when its MIR is not among them;
 * 'municipality' when they named municipalities in that MIR (away from home) and this is not one of them.
 */
export function sectionOutsideReach(section: string, reach: PersonReach): null | { kind: 'mir'; sectionMir: string } | { kind: 'municipality'; sectionMir: string; named: string[] } {
  const code = normalizeSection(section)
  const sectionMir = mirFromSection(code)
  if (!sectionMir || !padMir(reach.mir) && reach.radius !== 'region' && reach.radius !== 'distant') return null
  const mirs = acceptedMirs(reach)
  if (mirs.size === 0) return null
  if (!mirs.has(sectionMir)) return { kind: 'mir', sectionMir }
  const home = sectionMir === padMir(reach.mir) || (reach.radius !== 'region' && reach.radius !== 'distant')
  const stops = reach.travelStops.filter((stop) => stop.mir === sectionMir)
  if (stops.length === 0 || (home && reach.radius !== 'region')) return null
  const municipality = /^\d{9}$/.test(code) ? code.slice(2, 4) : ''
  if (!municipality || stops.some((stop) => stop.municipality === municipality)) return null
  return { kind: 'municipality', sectionMir, named: stops.map((stop) => stop.name).filter(Boolean) }
}

export function validateAssignment(input: {
  section: string
  personId: string
  personMir: string
  /** The person's stated places; without it only the home MIR counts. */
  reach?: PersonReach
  takenOrg: string | null
  duplicate: DuplicateOwner | null
}): AssignWarning[] {
  const section = normalizeSection(input.section)
  if (!section) return []

  const warnings: AssignWarning[] = []

  if (input.takenOrg) {
    warnings.push({
      code: 'taken',
      level: 'block',
      message: `Секцията е резервирана от ${input.takenOrg}. Там не записваме наши хора.`,
    })
  }

  if (input.duplicate && input.duplicate.id !== input.personId) {
    const where = input.duplicate.kind === 'published' ? 'публикувана' : 'в чернова'
    warnings.push({
      code: 'duplicate',
      level: 'block',
      message: `Секцията вече е ${where} при ${input.duplicate.email}.`,
    })
  }

  // Never blocks: an admin may place someone outside their stated places on purpose. Inside them: no warning.
  const reach = input.reach ?? { mir: input.personMir, region: '', radius: '', distantMirs: [], travelStops: [] }
  const outside = sectionOutsideReach(section, reach)
  if (outside?.kind === 'mir') {
    warnings.push({
      code: 'mir_mismatch',
      level: 'warn',
      message: `МИР на секцията е ${outside.sectionMir}, а човекът е в МИР ${padMir(reach.mir) || '—'} и не е посочил МИР ${outside.sectionMir}.`,
    })
  } else if (outside?.kind === 'municipality') {
    const named = outside.named.length ? `: ${outside.named.join(', ')}` : ''
    warnings.push({
      code: 'outside_places',
      level: 'warn',
      message: `В МИР ${outside.sectionMir} човекът е посочил други общини${named}.`,
    })
  }

  return warnings
}

/** Publish is blocked when any warning has level `block` (taken, duplicate). Outside the stated places only warns. */
export function publishBlocked(warnings: AssignWarning[]) {
  return warnings.some((warning) => warning.level === 'block')
}

export function warningSummary(warnings: AssignWarning[]) {
  return warnings.map((warning) => warning.message).join(' ')
}

export function scoreSectionSuggestions(
  sections: Array<{ id: string; place: string; votersCount?: number | null; isMachine?: boolean | null }>,
  person: SuggestPerson,
  blocked: Set<string>,
  limit = 8,
): SectionCandidate[] {
  const personMir = padMir(person.mir)
  const placeNorm = fold(person.place)
  const townNorm = fold(person.town)
  const municipalityNorm = fold(person.municipality)
  const travelNames = travelNamesOf(person.travelMunicipalities).map(fold).filter(Boolean)

  const scored: SectionCandidate[] = []
  for (const section of sections) {
    const id = normalizeSection(section.id)
    if (!id || blocked.has(id)) continue

    const sectionMir = mirFromSection(id)
    if (person.reach ? sectionOutsideReach(id, person.reach)?.kind === 'mir' : personMir && sectionMir && sectionMir !== personMir) continue

    let score = 10
    const reasons: string[] = ['свободна']

    if (personMir && sectionMir === personMir) {
      score += 40
      reasons.push('МИР')
    }

    const sectionPlace = fold(section.place)
    if (placeNorm && sectionPlace.includes(placeNorm)) {
      score += 35
      reasons.push('място')
    } else if (placeNorm && tokens(placeNorm).some((token) => token.length > 3 && sectionPlace.includes(token))) {
      score += 18
      reasons.push('близко място')
    }

    if (townNorm && sectionPlace.includes(townNorm)) {
      score += 12
      reasons.push('град')
    }

    if (municipalityNorm && sectionPlace.includes(municipalityNorm)) {
      score += 8
      reasons.push('община')
    }

    if (person.radius) score += 2

    if (travelNames.some((name) => name && sectionPlace.includes(name))) {
      score += 15
      reasons.push('пътуване')
    }

    const desk = sectionDesk(section)
    if (desk === 'paper') reasons.push('хартиена')
    else if (desk === 'machine') reasons.push('машинна')

    scored.push({
      id,
      place: section.place,
      score,
      reason: [...new Set(reasons)].join(' · '),
      desk,
    })
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return scored.slice(0, limit)
}

function parseJsonArray(raw: string | null | undefined): unknown[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function padMir(value: string) {
  const trimmed = value.trim()
  if (!/^\d{1,2}$/.test(trimmed)) return ''
  return trimmed.padStart(2, '0')
}

function fold(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('bg')
    .replace(/^гр\.?\s*/i, '')
    .replace(/^с\.?\s*/i, '')
    .replace(/\s+/g, ' ')
}

function tokens(value: string) {
  return value.split(/[\s,./\-]+/).filter(Boolean)
}

export function travelLabelOf(raw: string, radius = '') {
  if (radius !== 'region' && radius !== 'distant') return ''
  return travelNamesOf(raw).slice(0, 3).join(', ')
}

function travelNamesOf(raw: string) {
  if (!raw) return [] as string[]
  try {
    const parsed = JSON.parse(raw) as Array<{ name?: string }>
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => item.name ?? '').filter(Boolean)
  } catch {
    return []
  }
}

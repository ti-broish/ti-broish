import { mirFromSection, normalizeSection } from './admin-csv'

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

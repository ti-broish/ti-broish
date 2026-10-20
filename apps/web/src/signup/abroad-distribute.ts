import { normalizeSection } from './admin-csv'
import { compareAbroadSections, TIER_RANK, type AbroadTierLetter } from './abroad-coverage'
import { namesMatch } from './abroad-normalize'

export type AbroadSkipReason = 'no_city' | 'city_not_found' | 'no_capacity' | 'not_abroad' | 'mobile' | 'video'

export interface AbroadDistributePerson {
  id: string
  email: string
  role: string
  mobileTeam: boolean
  regionCode: string
  mir: string
  countryName: string
  cityName: string
}

export interface AbroadDistributeSection {
  id: string
  country: string
  city: string
  placeLabel: string
  tierLetter: AbroadTierLetter
  /**
   * Volunteer slots in this run. One person per section: a second draft on the same
   * section is a `duplicate` that blocks publish (see validateAssignment).
   */
  capacity: number
  /** Empty ПП-ДБ commission seats; ranks sections within a tier (more gaps first). */
  emptyPpdbSeats?: number
}

export interface AbroadDraftAssignment {
  personId: string
  email: string
  sectionId: string
  country: string
  city: string
  tierLetter: AbroadTierLetter
}

export interface AbroadDistributePlan {
  assignments: AbroadDraftAssignment[]
  unmatched: Array<{ personId: string; email: string; reason: AbroadSkipReason; detail?: string }>
  counts: {
    assigned: number
    byTier: Partial<Record<AbroadTierLetter, number>>
    byCountry: Array<{ country: string; count: number }>
    unmatchedByReason: Partial<Record<AbroadSkipReason, number>>
  }
}

/** DRAFT planner only — never publishes; caller persists drafts. */
export function distributeAbroad(input: {
  people: AbroadDistributePerson[]
  sections: AbroadDistributeSection[]
  blocked?: readonly string[]
}): AbroadDistributePlan {
  const blocked = new Set((input.blocked ?? []).map((code) => normalizeSection(code)).filter(Boolean))
  const remaining = new Map<string, number>()
  const byId = new Map<string, AbroadDistributeSection>()

  for (const section of input.sections) {
    const id = normalizeSection(section.id)
    if (!id || !/^32\d{7}$/.test(id)) continue
    if (byId.has(id)) continue
    byId.set(id, { ...section, id })
    remaining.set(id, Math.min(1, Math.max(0, Math.floor(section.capacity))))
  }

  const assignments: AbroadDraftAssignment[] = []
  const unmatched: AbroadDistributePlan['unmatched'] = []

  for (const person of input.people) {
    const skip = skipReason(person)
    if (skip) {
      unmatched.push({ personId: person.id, email: person.email, reason: skip })
      continue
    }

    const city = person.cityName.trim()
    if (!city) {
      unmatched.push({ personId: person.id, email: person.email, reason: 'no_city' })
      continue
    }

    const country = person.countryName.trim()
    const detail = country ? `${country} / ${city}` : city
    const matched = [...byId.values()].filter((section) => {
      if (!cityMatchesSection(city, section)) return false
      if (country && !namesMatch(country, section.country)) return false
      return true
    })

    if (matched.length === 0) {
      unmatched.push({ personId: person.id, email: person.email, reason: 'city_not_found', detail })
      continue
    }

    const free = matched
      .filter((section) => !blocked.has(section.id) && (remaining.get(section.id) ?? 0) > 0)
      .sort(
        (a, b) =>
          TIER_RANK[a.tierLetter] - TIER_RANK[b.tierLetter] ||
          (b.emptyPpdbSeats ?? 0) - (a.emptyPpdbSeats ?? 0) ||
          compareAbroadSections(
            { tierLetter: a.tierLetter, sectionCode: a.id },
            { tierLetter: b.tierLetter, sectionCode: b.id },
          ),
      )

    const pick = free[0]
    if (!pick) {
      unmatched.push({ personId: person.id, email: person.email, reason: 'no_capacity', detail })
      continue
    }

    remaining.set(pick.id, (remaining.get(pick.id) ?? 0) - 1)
    assignments.push({
      personId: person.id,
      email: person.email,
      sectionId: pick.id,
      country: pick.country,
      city: pick.city,
      tierLetter: pick.tierLetter,
    })
  }

  return { assignments, unmatched, counts: countPlan(assignments, unmatched) }
}

function cityMatchesSection(city: string, section: AbroadDistributeSection) {
  return namesMatch(city, section.city) || namesMatch(city, section.placeLabel)
}

function skipReason(person: AbroadDistributePerson): AbroadSkipReason | null {
  if (!isAbroadPerson(person)) return 'not_abroad'
  if (person.mobileTeam || person.role === 'mobile') return 'mobile'
  if (person.role === 'video') return 'video'
  if (person.role !== 'section') return 'mobile'
  return null
}

function isAbroadPerson(person: AbroadDistributePerson) {
  return person.regionCode.trim() === '32' || padMir(person.mir) === '32'
}

function padMir(value: string) {
  const trimmed = value.trim()
  if (!/^\d{1,2}$/.test(trimmed)) return ''
  return trimmed.padStart(2, '0')
}

function countPlan(
  assignments: AbroadDraftAssignment[],
  unmatched: AbroadDistributePlan['unmatched'],
): AbroadDistributePlan['counts'] {
  const byTier: Partial<Record<AbroadTierLetter, number>> = {}
  const countryCounts = new Map<string, number>()
  for (const row of assignments) {
    byTier[row.tierLetter] = (byTier[row.tierLetter] ?? 0) + 1
    countryCounts.set(row.country, (countryCounts.get(row.country) ?? 0) + 1)
  }
  const unmatchedByReason: Partial<Record<AbroadSkipReason, number>> = {}
  for (const row of unmatched) {
    unmatchedByReason[row.reason] = (unmatchedByReason[row.reason] ?? 0) + 1
  }
  return {
    assigned: assignments.length,
    byTier,
    byCountry: [...countryCounts.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country, 'bg')),
    unmatchedByReason,
  }
}

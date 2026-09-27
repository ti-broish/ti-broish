import type { Companion, Profile } from './model'
import { isPersonalReferral, mirOf, validEgn } from './rules'

export interface SignupColumns {
  email: string
  source: string | null
  referredBy: string | null
  egn: string
  role: string | null
  roundsFirst: number
  roundsRunoff: number
  experience: string | null
  regionCode: string | null
  mirCode: string | null
  municipalityName: string | null
  townName: string | null
  cityRegionCode: string | null
  cityRegionName: string | null
  sectionPlace: string | null
  paperCount: number | null
  machineCount: number | null
  radius: string | null
  extraCityRegions: string
  distantRegionCodes: string
  travelMunicipalities: string
  hasCar: number | null
  carSeats: number
  hasDrone: number | null
  coordinator: number
  emailConfirmed: number
  consent: number
  submitted: number
  withdrawn: number
  notes: string
  payload: string
}

export interface CompanionRow {
  id: string
  inGroup: number
  firstName: string
  middleName: string
  lastName: string
  email: string
  phone: string
  role: string | null
  samePlace: number
}

export function storedProfile(profile: Profile): Profile {
  const email = profile.email.trim().toLowerCase()
  let source = profile.source?.trim().toLowerCase() || null
  let referredBy = profile.referredBy?.trim() || null
  if (referredBy && !isPersonalReferral(referredBy)) {
    source = source || referredBy.toLowerCase()
    referredBy = null
  }
  const stored = { ...profile, email, source, referredBy }
  delete (stored as { demoState?: unknown }).demoState
  return stored
}

export function signupColumns(profile: Profile): SignupColumns {
  const stored = storedProfile(profile)
  const place = stored.place
  const { egn: _egn, assignedSection: _assigned, ...withoutEgn } = stored
  return {
    email: stored.email,
    source: stored.source,
    referredBy: stored.referredBy,
    egn: stored.egn,
    role: stored.role,
    roundsFirst: stored.rounds.first ? 1 : 0,
    roundsRunoff: stored.rounds.runoff ? 1 : 0,
    experience: stored.experience,
    regionCode: place?.regionCode ?? null,
    mirCode: mirOf(place),
    municipalityName: place?.municipalityName ?? null,
    townName: place?.townName ?? null,
    cityRegionCode: place?.cityRegionCode ?? null,
    cityRegionName: place?.cityRegionName ?? null,
    sectionPlace: place?.sectionPlace ?? null,
    paperCount: place?.paperCount ?? null,
    machineCount: place?.machineCount ?? null,
    radius: stored.radius,
    extraCityRegions: JSON.stringify(stored.extraCityRegions ?? []),
    distantRegionCodes: JSON.stringify(stored.distantRegionCodes ?? []),
    travelMunicipalities: JSON.stringify(stored.travelMunicipalities ?? []),
    hasCar: bit(stored.hasCar),
    carSeats: stored.carSeats ?? 0,
    hasDrone: bit(stored.hasDrone),
    coordinator: stored.coordinator ? 1 : 0,
    emailConfirmed: stored.emailConfirmed ? 1 : 0,
    consent: stored.consent ? 1 : 0,
    submitted: stored.submitted ? 1 : 0,
    withdrawn: stored.withdrawn ? 1 : 0,
    notes: stored.notes ?? '',
    payload: JSON.stringify({ ...withoutEgn, egn: '' }),
  }
}

export function companionRows(companions: Companion[]): CompanionRow[] {
  return companions.map((person) => ({
    id: person.id,
    inGroup: person.inGroup === false ? 0 : 1,
    firstName: person.firstName,
    middleName: person.middleName,
    lastName: person.lastName,
    email: person.email.trim().toLowerCase(),
    phone: person.phone,
    role: person.role,
    samePlace: person.samePlace ? 1 : 0,
  }))
}

export function egnProblem(egn: string) {
  if (!egn) return null
  return validEgn(egn) ? null : 'ЕГН не е валидно.'
}

function bit(value: boolean | null | undefined) {
  if (value == null) return null
  return value ? 1 : 0
}

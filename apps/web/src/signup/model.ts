import { CALL_MESSAGE_MAX, type CantReachSection } from './cant-reach'
import { inPlace } from './copy'

export type { CantReachSection }

export type Role = 'section' | 'mobile' | 'video'

export type Radius = 'cityRegion' | 'nearby' | 'settlement' | 'municipality' | 'region' | 'distant'

export type Experience = 'never' | 'counted' | 'sik' | 'sik-lead' | 'code'

export interface HomePlace {
  regionCode: string
  regionName: string
  municipalityCode?: string
  municipalityName?: string
  townId?: number
  townName?: string
  cityRegionCode?: string
  cityRegionName?: string
  sectionId?: string
  sectionPlace?: string
  paperCount?: number | null
  machineCount?: number | null
  countryCode?: string
  countryName?: string
}

export interface NamedPlace {
  code: string
  name: string
}

export interface TravelStop {
  regionCode: string
  regionName: string
  code: string
  name: string
}

export interface Companion {
  id: string
  mode: 'full' | 'invite'
  firstName: string
  middleName: string
  lastName: string
  email: string
  phone: string
  role: Role | null
  mobileTeam: boolean
  rounds: { first: boolean; runoff: boolean }
  experience: Experience | null
  samePlace: boolean
  inGroup: boolean
  status: 'pending' | 'confirmed'
}

export interface Profile {
  firstName: string
  middleName: string
  lastName: string
  email: string
  phone: string
  emailConfirmed: boolean
  confirmCode: string
  egn: string
  role: Role | null
  mobileTeam: boolean
  rounds: { first: boolean; runoff: boolean }
  experience: Experience | null
  place: HomePlace | null
  radius: Radius | null
  distantRegionCodes: string[]
  extraCityRegions: NamedPlace[]
  travelMunicipalities: TravelStop[]
  coordinator: boolean
  carSeats: number
  hasCar: boolean | null
  hasDrone: boolean | null
  wantsAction: boolean
  companions: Companion[]
  inviteCode: string
  joinedInvite: string | null
  referralCode: string
  referredBy: string | null
  referrerName: string | null
  source: string | null
  notes: string
  callRequestedAt: string | null
  callMessage: string
  /** Structured can't-reach report for the published section. Cleared when that section changes. */
  cantReachSection: CantReachSection | null
  consent: boolean
  submitted: boolean
  withdrawn: boolean
  /** True when an admin ran Отпиши (withdrawn_at/by set). Self-service withdraw leaves this false. */
  withdrawnByAdmin: boolean
  assignedSection: string | null
}

export const emptyProfile = (): Profile => ({
  firstName: '',
  middleName: '',
  lastName: '',
  email: '',
  phone: '',
  emailConfirmed: false,
  confirmCode: '',
  egn: '',
  role: null,
  mobileTeam: false,
  rounds: { first: true, runoff: true },
  experience: null,
  place: null,
  radius: null,
  distantRegionCodes: [],
  extraCityRegions: [],
  travelMunicipalities: [],
  coordinator: false,
  carSeats: 0,
  hasCar: null,
  hasDrone: null,
  wantsAction: false,
  companions: [],
  inviteCode: '',
  joinedInvite: null,
  referralCode: '',
  referredBy: null,
  referrerName: null,
  source: null,
  notes: '',
  callRequestedAt: null,
  callMessage: '',
  cantReachSection: null,
  consent: false,
  submitted: false,
  withdrawn: false,
  withdrawnByAdmin: false,
  assignedSection: null,
})

export const EXPERIENCE: { id: Experience; title: string; text: string }[] = [
  { id: 'never', title: 'За първи път', text: 'Не си бил в изборна секция като доброволец или член на СИК.' },
  { id: 'counted', title: 'Броил си 1–2 пъти', text: 'Бил си доброволец, но само за броенето.' },
  { id: 'sik', title: 'Бил си член на СИК', text: 'Участвал си в секционна избирателна комисия.' },
  { id: 'sik-lead', title: 'Бил си в ръководството на СИК', text: 'Председател, заместник или секретар.' },
  { id: 'code', title: 'Уверен си, че познаваш Изборния кодекс напълно.', text: '' },
]

export const SECTION_STEPS = [
  'contact',
  'confirm',
  'egn',
  'role',
  'rounds',
  'experience',
  'place',
  'travel',
  'seats',
  'people',
  'review',
] as const

export const VIDEO_STEPS = ['contact', 'confirm', 'egn', 'role', 'rounds', 'experience', 'review'] as const

export type StepId = (typeof SECTION_STEPS)[number] | (typeof VIDEO_STEPS)[number]

export function travelsOutside(radius: Radius | null) {
  return radius === 'municipality' || radius === 'region' || radius === 'distant'
}

export function shouldAskSeats(profile: Pick<Profile, 'role' | 'radius'>) {
  return profile.role === 'mobile' || travelsOutside(profile.radius)
}

export function stepsFor(profile: Pick<Profile, 'role' | 'radius'>): readonly StepId[] {
  const steps = profile.role === 'video' ? VIDEO_STEPS : SECTION_STEPS
  return steps.filter((step) => step !== 'seats' || shouldAskSeats(profile))
}

type AssignmentWave = { iso: string; label: string; round: 'first' | 'runoff' }

/**
 * The days sections were released. People who sign up for the runoff after the last wave (26 октомври)
 * get a section from the admins by hand, with no fixed date (see the profile's „преди балотажа“ note).
 */
export const ASSIGNMENT_WAVES: readonly AssignmentWave[] = [
  { iso: '2026-10-05', label: '5 октомври', round: 'first' },
  { iso: '2026-10-12', label: '12 октомври', round: 'first' },
  { iso: '2026-10-19', label: '19 октомври', round: 'first' },
  { iso: '2026-10-26', label: '26 октомври', round: 'runoff' },
]

/** True when every wave is behind us (the returned wave from nextAssignment is in the past). */
export function assignmentWavePassed(wave: Pick<AssignmentWave, 'iso'> | undefined, now = new Date()) {
  return !wave || wave.iso < now.toISOString().slice(0, 10)
}

export function nextAssignment(profile: Pick<Profile, 'rounds'>, now = new Date()) {
  const relevant = ASSIGNMENT_WAVES.filter(
    (wave) => (wave.round === 'first' && profile.rounds.first) || (wave.round === 'runoff' && profile.rounds.runoff),
  )
  const waves = relevant.length > 0 ? relevant : ASSIGNMENT_WAVES
  const today = now.toISOString().slice(0, 10)
  return waves.find((wave) => wave.iso >= today) ?? waves[waves.length - 1]
}

export function assignmentLocked(profile: Pick<Profile, 'assignedSection'>) {
  return Boolean(profile.assignedSection)
}

export function profileView(profile: Profile): 'incomplete' | 'waiting' | 'assigned' {
  // Withdrawn first: a withdrawn volunteer no longer holds the seat, even before the reload clears it.
  if (profile.withdrawn) return 'incomplete'
  if (profile.assignedSection) return 'assigned'
  if (signupGap(profile)) return 'incomplete'
  return 'waiting'
}

/** A call request counts only with a reason. An empty reason drops the request. */
export function normalizeCallRequest<T extends { callRequestedAt: string | null; callMessage: string }>(profile: T): T {
  const message = profile.callMessage.trim().slice(0, CALL_MESSAGE_MAX)
  if (!message) return { ...profile, callRequestedAt: null, callMessage: '' }
  return { ...profile, callMessage: message }
}

export function signupGap(profile: Profile): string | null {
  if (!profile.firstName || !profile.email || !profile.phone) return 'Остават имената, имейлът и телефонът.'
  if (!profile.emailConfirmed) return 'Остава да потвърдиш имейла.'
  if (!profile.egn) return 'Остава ЕГН, за да те разпределим.'
  if (!profile.role || profile.role === 'video') return 'Остава да избереш секция или мобилен екип.'
  if (!profile.rounds.first && !profile.rounds.runoff) return 'Остава поне един от двата дни.'
  if (!profile.place || !placeReady(profile.place)) return 'Остава да избереш място.'
  if (!profile.radius) return 'Остава докъде можеш да стигнеш.'
  if (!profile.consent) return 'Остава потвърждението, че записването е доброволно.'
  return null
}

/** The signup step that fills the current gap. Consent stays on the review step. */
export function resumeSignupStep(profile: Profile): StepId {
  if (!profile.firstName || !profile.email || !profile.phone) return 'contact'
  if (!profile.emailConfirmed) return 'confirm'
  if (!profile.egn) return 'egn'
  if (!profile.role || profile.role === 'video') return 'role'
  if (!profile.rounds.first && !profile.rounds.runoff) return 'rounds'
  if (!profile.experience) return 'experience'
  if (!profile.place || !placeReady(profile.place)) return 'place'
  if (!profile.radius) return 'travel'
  return 'review'
}

/** Already in the register: submitted, or a complete form the autosave has not flagged yet. Withdrawn signups are not. */
export function registrationSettled(profile: Profile) {
  return !profile.withdrawn && (profile.submitted || signupGap(profile) === null)
}

function plainTown(name: string | undefined) {
  return name?.replace(/^(гр\.|с\.|к\.|ман\.)\s*/u, '')
}

function districtQuery(place: HomePlace) {
  return [`район ${place.cityRegionName}`, plainTown(place.townName), place.regionName, 'България'].filter(Boolean).join(', ')
}

function townQuery(place: HomePlace) {
  return [plainTown(place.townName), place.municipalityName, place.regionName, 'България'].filter(Boolean).join(', ')
}

function municipalityQuery(place: HomePlace) {
  return [place.municipalityName, place.regionName, 'България'].filter(Boolean).join(', ')
}

export function mapZoom(place: HomePlace | null, radius: Radius | null) {
  if (!place) return null
  if (place.regionCode === '32') {
    if (radius === 'distant') return null
    if (radius === 'region') return 6
    return place.townName ? 12 : 6
  }
  if (radius === 'region' || radius === 'distant') return null
  if (radius === 'cityRegion') return place.cityRegionName ? 14 : null
  if (radius === 'settlement') return place.townName ? 13 : null
  if (radius === 'municipality') return place.municipalityName ? 11 : null
  if (place.cityRegionName && place.townName) return 14
  if (place.townName) return 13
  if (place.municipalityName) return 11
  return null
}

export function mapQuery(place: HomePlace | null, radius: Radius | null) {
  if (!place) return null
  if (place.regionCode === '32') {
    if (radius === 'distant') return null
    if (radius === 'region') return place.countryName || null
    return [place.townName, place.countryName].filter(Boolean).join(', ') || null
  }
  if (radius === 'region' || radius === 'distant') return null
  if (radius === 'cityRegion' && place.cityRegionName) return districtQuery(place)
  if (radius === 'municipality' && place.municipalityName) return municipalityQuery(place)
  if (radius === 'settlement' && place.townName) return townQuery(place)
  if (place.cityRegionName && place.townName) return districtQuery(place)
  if (!place.townName && place.municipalityName) return municipalityQuery(place)
  if (!place.townName) return null
  return townQuery(place)
}

export interface OutlineRequest {
  id: string
  query: string
  abroad: boolean
  scope: 'broad' | 'local'
  selected?: boolean
}

export function placeOutline(place: HomePlace | null): OutlineRequest[] {
  if (!place) return []
  if (place.regionCode === '32') {
    const query = [place.townName, place.countryName].filter(Boolean).join(', ')
    return query ? [{ id: 'abroad', query, abroad: true, scope: 'local' }] : []
  }
  if (place.cityRegionName && place.townName) {
    return [{ id: `district:${place.cityRegionCode ?? place.cityRegionName}`, query: districtQuery(place), abroad: false, scope: 'local' }]
  }
  if (place.townName) return [{ id: 'town', query: townQuery(place), abroad: false, scope: 'local' }]
  if (place.municipalityName) return [{ id: 'municipality', query: municipalityQuery(place), abroad: false, scope: 'broad' }]
  return []
}

function districtRequest(place: HomePlace, item: { code: string; name: string }, selected: boolean): OutlineRequest {
  const town = plainTown(place.townName)
  return {
    id: `district:${item.code}`,
    query: [`район ${item.name}`, town, place.regionName, 'България'].filter(Boolean).join(', '),
    abroad: false,
    scope: 'local',
    selected,
  }
}

function chosenFirst<T extends { selected?: boolean }>(items: T[]) {
  return [...items.filter((item) => item.selected), ...items.filter((item) => !item.selected)]
}

export function cityRegionOutlines(place: HomePlace | null, districts: { code: string; name: string }[]): OutlineRequest[] {
  if (!place || place.regionCode === '32' || districts.length === 0) return []
  return chosenFirst(districts.map((item) => districtRequest(place, item, item.code === place.cityRegionCode)))
}

export function travelOutline(
  profile: Pick<Profile, 'place' | 'radius' | 'extraCityRegions' | 'travelMunicipalities'>,
  cityRegions: { code: string; name: string }[] = [],
): OutlineRequest[] {
  const place = profile.place
  if (!place) return []
  if (place.regionCode === '32') return placeOutline(place)
  const cityScale = profile.radius == null || profile.radius === 'cityRegion' || profile.radius === 'nearby' || profile.radius === 'settlement'
  if (cityScale && cityRegions.length > 0) {
    const chosen = new Set(
      (profile.radius === 'nearby' ? [place.cityRegionCode, ...profile.extraCityRegions.map((item) => item.code)] : [place.cityRegionCode]).filter(
        (code): code is string => Boolean(code),
      ),
    )
    return chosenFirst(cityRegions.map((item) => districtRequest(place, item, chosen.has(item.code))))
  }
  if (profile.radius === 'nearby') {
    const town = plainTown(place.townName)
    const districts = [
      ...(place.cityRegionName ? [{ code: place.cityRegionCode ?? place.cityRegionName, name: place.cityRegionName }] : []),
      ...profile.extraCityRegions,
    ]
    return districts.map((item) => ({
      id: `district:${item.code}`,
      query: [`район ${item.name}`, town, place.regionName, 'България'].filter(Boolean).join(', '),
      abroad: false,
      scope: 'local' as const,
    }))
  }
  if (profile.radius === 'region' || profile.radius === 'distant') {
    return profile.travelMunicipalities.map((item) => ({
      id: `stop:${item.regionCode}:${item.code}`,
      query: [item.name, item.regionName, 'България'].filter(Boolean).join(', '),
      abroad: false,
      scope: 'broad' as const,
    }))
  }
  if (profile.radius === 'cityRegion' || profile.radius === 'settlement' || profile.radius === 'municipality') {
    const query = mapQuery(place, profile.radius)
    return query ? [{ id: profile.radius, query, abroad: false, scope: profile.radius === 'municipality' ? 'broad' : 'local' }] : []
  }
  return placeOutline(place)
}

/** A Nominatim boundary, smaller than the oblast outline. Oblast and extra oblasts use the local GeoJSON instead. */
export function mapUsesBoundary(place: HomePlace | null, radius: Radius | null) {
  if (!place) return false
  if (radius === 'region' || radius === 'distant') return place.regionCode === '32' && radius === 'region'
  return Boolean(mapQuery(place, radius))
}

/** Broad picks the larger administrative outline (municipality or country). Local picks the smaller one (district or settlement). */
export function mapScope(place: HomePlace | null, radius: Radius | null): 'broad' | 'local' | null {
  if (!mapUsesBoundary(place, radius)) return null
  if (radius === 'municipality') return 'broad'
  if (place?.regionCode === '32' && radius === 'region') return 'broad'
  if (!radius && place && !place.townName && place.municipalityName) return 'broad'
  return 'local'
}

export function homeRegionCodes(place: HomePlace | null) {
  if (!place || place.regionCode === '32') return []
  if (place.regionCode === 'sofia-merged') return ['23', '24', '25']
  return [place.regionCode]
}

export function highlightCodes(place: HomePlace | null, radius: Radius | null, distant: string[]) {
  if (!place || place.regionCode === '32') return []
  const home = homeRegionCodes(place)
  if (radius !== 'distant') return home
  return [...home, ...distant.filter((code) => !home.includes(code))]
}

function regionKey(code: string) {
  const trimmed = code.trim()
  if (!/^\d{1,2}$/.test(trimmed)) return ''
  return trimmed.padStart(2, '0')
}

/**
 * A town, municipality, or district does not use oblast municipalities or extra
 * districts. Nearby keeps only the extra districts. An oblast keeps municipalities
 * in that oblast. Other oblasts keep their own.
 */
export function scopeForRadius(
  radius: Radius | null,
  place: HomePlace | null,
  current: { extraCityRegions: NamedPlace[]; distantRegionCodes: string[]; travelMunicipalities: TravelStop[] },
) {
  if (radius === 'nearby') {
    return { extraCityRegions: current.extraCityRegions, distantRegionCodes: [] as string[], travelMunicipalities: [] as TravelStop[] }
  }
  if (radius === 'region') {
    const home = new Set(homeRegionCodes(place).map(regionKey))
    return {
      extraCityRegions: [] as NamedPlace[],
      distantRegionCodes: [] as string[],
      travelMunicipalities: current.travelMunicipalities.filter((stop) => home.has(regionKey(stop.regionCode))),
    }
  }
  if (radius === 'distant') {
    const distant = new Set(current.distantRegionCodes.map(regionKey))
    return {
      extraCityRegions: [] as NamedPlace[],
      distantRegionCodes: current.distantRegionCodes,
      travelMunicipalities: current.travelMunicipalities.filter((stop) => distant.has(regionKey(stop.regionCode))),
    }
  }
  return { extraCityRegions: [] as NamedPlace[], distantRegionCodes: [] as string[], travelMunicipalities: [] as TravelStop[] }
}

export function toggleDistantCodes(codes: string[], stops: TravelStop[], code: string) {
  const key = regionKey(code)
  const exists = codes.some((item) => regionKey(item) === key)
  if (!exists) return { distantRegionCodes: [...codes, code], travelMunicipalities: stops }
  return {
    distantRegionCodes: codes.filter((item) => regionKey(item) !== key),
    travelMunicipalities: stops.filter((stop) => regionKey(stop.regionCode) !== key),
  }
}

export function roleLabel(role: Role | null, mobileTeam = false) {
  if (role === 'mobile' || mobileTeam) return 'Мобилен екип'
  if (role === 'video') return 'Видеонаблюдение от вкъщи'
  return 'Секция'
}

/** The role as the person chose it on the role step, for the review and the profile. */
export function roleTitle(role: Role | null, mobileTeam = false) {
  if (role === 'mobile' || mobileTeam) return 'Мобилен екип'
  if (role === 'video') return 'Видеонаблюдение от вкъщи'
  if (role === 'section') return 'Секция с гласуване на хартия'
  return 'Още не е избрана'
}

export function codeFor(email: string) {
  let n = 0
  for (const char of email.trim().toLowerCase()) n = (n * 33 + char.charCodeAt(0)) >>> 0
  return String(n % 1_000_000).padStart(6, '0')
}

export function validName(value: string) {
  const trimmed = value.trim()
  return trimmed.length >= 2 && /^[\u0400-\u04FF][\u0400-\u04FF\s'-]*$/.test(trimmed)
}

export function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function validPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 9 && digits.length <= 13
}

export function radiusOptions(place: HomePlace | null): { id: Radius; label: string }[] {
  if (!place) return []
  if (place.regionCode === '32') {
    return [
      { id: 'settlement', label: place.townName ? `Само ${inPlace(place.townName)}` : 'Само в града' },
      { id: 'region', label: place.countryName ? inPlace(place.countryName, true) : 'В държавата' },
      { id: 'distant', label: 'И в други държави' },
    ]
  }
  const options: { id: Radius; label: string }[] = []
  if (place.cityRegionName) {
    options.push({ id: 'cityRegion', label: `Само ${inPlace(place.cityRegionName)}` })
    options.push({ id: 'nearby', label: 'В избрани райони наблизо' })
  }
  options.push({
    id: 'settlement',
    label: place.townName ? inPlace(place.townName, true) : 'В населеното място',
  })
  options.push({
    id: 'municipality',
    label: place.municipalityName ? `В община ${place.municipalityName}` : 'В общината',
  })
  options.push({
    id: 'region',
    label: place.regionName.includes('София') ? inPlace(place.regionName, true) : `В област ${place.regionName}`,
  })
  options.push({ id: 'distant', label: 'И в други области' })
  return options
}

export function placeReady(place: HomePlace | null) {
  if (!place) return false
  if (place.regionCode === '32') return Boolean(place.countryCode && place.townName?.trim())
  return Boolean(place.municipalityCode && place.townId)
}

export function placeLabel(place: HomePlace | null) {
  if (!place) return 'Още няма избрано място'
  const parts = [place.regionName, place.municipalityName, place.townName, place.cityRegionName, place.sectionPlace, place.countryName]
    .filter(Boolean)
  return parts.join(', ')
}

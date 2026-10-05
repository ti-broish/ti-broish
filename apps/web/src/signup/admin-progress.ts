import {
  radiusOptions,
  signupGap,
  type Experience,
  type HomePlace,
  type NamedPlace,
  type Profile,
  type Radius,
  type Role,
  type TravelStop,
} from './model'
import { signupColumns } from './record'

export type SignupProgress = 'finished' | 'started' | 'withdrawn'

const STAFF_GAP: Record<string, string> = {
  'Остават имената, имейлът и телефонът.': 'Липсват имена, имейл или телефон.',
  'Остава да потвърдиш имейла.': 'Имейлът не е потвърден.',
  'Остава ЕГН, за да те разпределим.': 'Няма ЕГН.',
  'Остава да избереш секция или мобилен екип.': 'Няма избрана секция или мобилен екип.',
  'Остава поне един от двата дни.': 'Няма избран ден.',
  'Остава да избереш място.': 'Няма избрано място.',
  'Остава докъде можеш да стигнеш.': 'Не е избрано докъде може да стигне.',
  'Остава потвърждението, че записването е доброволно.': 'Няма потвърждение, че записването е доброволно.',
}

export function signupProgress(person: { submitted: boolean; withdrawn: boolean }): SignupProgress {
  if (person.withdrawn) return 'withdrawn'
  if (person.submitted) return 'finished'
  return 'started'
}

export function progressLabel(progress: SignupProgress) {
  if (progress === 'finished') return 'Завършил'
  if (progress === 'withdrawn') return 'Оттеглен'
  return 'Започнал'
}

/** What is still missing, in the voice of the team rather than the volunteer. */
export function staffGapText(profile: Profile) {
  const gap = signupGap(profile)
  if (!gap) return null
  return STAFF_GAP[gap] ?? gap
}

export interface StaffEdit {
  firstName: string
  middleName: string
  lastName: string
  phone: string
  role: Role | null
  roundsFirst: boolean
  roundsRunoff: boolean
  experience: Experience | null
  radius?: Radius | null
  extraCityRegions?: NamedPlace[]
  distantRegionCodes?: string[]
  travelMunicipalities?: TravelStop[]
}

export function applyStaffEdit(profile: Profile, edit: StaffEdit): Profile {
  const radius = edit.radius === undefined ? profile.radius : edit.radius
  const nearby = radius === 'nearby'
  return {
    ...profile,
    firstName: edit.firstName.trim(),
    middleName: edit.middleName.trim(),
    lastName: edit.lastName.trim(),
    phone: edit.phone.trim(),
    role: edit.role,
    rounds: { first: edit.roundsFirst, runoff: edit.roundsRunoff },
    experience: edit.experience,
    radius,
    extraCityRegions: edit.extraCityRegions === undefined ? (nearby ? profile.extraCityRegions : []) : nearby ? edit.extraCityRegions : [],
    distantRegionCodes: edit.distantRegionCodes === undefined ? profile.distantRegionCodes : edit.distantRegionCodes,
    travelMunicipalities: edit.travelMunicipalities === undefined ? profile.travelMunicipalities : edit.travelMunicipalities,
  }
}

export function nextStaffCall(current: { at: string; by: string }, called: boolean, actor: string, now: string) {
  if (!called) return { at: '', by: '' }
  if (current.at) return { at: current.at, by: current.by }
  return { at: now, by: actor }
}

export function clipStaffText(value: string, max: number) {
  return value.trim().slice(0, max)
}

export function parseRoleChoice(value: string): Role | null {
  if (value === 'section' || value === 'mobile' || value === 'video') return value
  return null
}

export function parseExperienceChoice(value: string): Experience | null {
  if (value === 'never' || value === 'counted' || value === 'sik' || value === 'sik-lead' || value === 'code') return value
  return null
}

export function parseRadiusChoice(value: string, place: HomePlace | null): Radius | null {
  return radiusOptions(place).find((option) => option.id === value)?.id ?? null
}

export function clipNamedPlaces(value: unknown): NamedPlace[] {
  if (!Array.isArray(value)) return []
  const places: NamedPlace[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const code = clipStaffText(String((item as { code?: unknown }).code ?? ''), 40)
    const name = clipStaffText(String((item as { name?: unknown }).name ?? ''), 80)
    if (!code || !name || places.some((place) => place.code === code)) continue
    places.push({ code, name })
    if (places.length >= 40) break
  }
  return places
}

export function clipRegionCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const codes: string[] = []
  for (const item of value) {
    const code = String(item ?? '').trim()
    if (!/^\d{2}$/.test(code) || codes.includes(code)) continue
    codes.push(code)
    if (codes.length >= 20) break
  }
  return codes
}

export function clipTravelStops(value: unknown): TravelStop[] {
  if (!Array.isArray(value)) return []
  const stops: TravelStop[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const regionCode = clipStaffText(String((item as { regionCode?: unknown }).regionCode ?? ''), 8)
    const regionName = clipStaffText(String((item as { regionName?: unknown }).regionName ?? ''), 80)
    const code = clipStaffText(String((item as { code?: unknown }).code ?? ''), 40)
    const name = clipStaffText(String((item as { name?: unknown }).name ?? ''), 80)
    if (!/^\d{2}$/.test(regionCode) || !code || !name) continue
    if (stops.some((stop) => stop.regionCode === regionCode && stop.code === code)) continue
    stops.push({ regionCode, regionName, code, name })
    if (stops.length >= 40) break
  }
  return stops
}

const REGION_NAMES: Record<string, string> = {
  '01': 'Благоевград',
  '02': 'Бургас',
  '03': 'Варна',
  '04': 'Велико Търново',
  '05': 'Видин',
  '06': 'Враца',
  '07': 'Габрово',
  '08': 'Добрич',
  '09': 'Кърджали',
  '10': 'Кюстендил',
  '11': 'Ловеч',
  '12': 'Монтана',
  '13': 'Пазарджик',
  '14': 'Перник',
  '15': 'Плевен',
  '16': 'Пловдив',
  '17': 'Пловдив',
  '18': 'Разград',
  '19': 'Русе',
  '20': 'Силистра',
  '21': 'Сливен',
  '22': 'Смолян',
  '23': 'София-град',
  '24': 'София-град',
  '25': 'София-град',
  '26': 'София',
  '27': 'Стара Загора',
  '28': 'Търговище',
  '29': 'Хасково',
  '30': 'Шумен',
  '31': 'Ямбол',
}

export function staffTravelText(profile: Pick<Profile, 'place' | 'radius' | 'extraCityRegions' | 'distantRegionCodes' | 'travelMunicipalities'>) {
  const option = radiusOptions(profile.place).find((item) => item.id === profile.radius)
  if (!option) return 'Без обхват'
  const parts = [option.label]
  if (profile.radius === 'nearby' && profile.extraCityRegions.length > 0) {
    parts.push(profile.extraCityRegions.map((item) => item.name).join(', '))
  }
  if (profile.radius === 'distant' && profile.distantRegionCodes.length > 0) {
    parts.push(profile.distantRegionCodes.map((code) => REGION_NAMES[code] ?? code).join(', '))
  }
  if ((profile.radius === 'region' || profile.radius === 'distant') && profile.travelMunicipalities.length > 0) {
    parts.push(profile.travelMunicipalities.map((item) => item.name).join(', '))
  }
  return parts.join(' · ')
}

export function roleLabel(role: string | null) {
  if (role === 'mobile') return 'Мобилен екип'
  if (role === 'video') return 'Видеонаблюдение'
  if (role === 'section') return 'Секция'
  return 'Без избор'
}

export function daysLabel(first: boolean, runoff: boolean) {
  if (first && runoff) return '25 октомври и 1 ноември'
  if (first) return '25 октомври'
  if (runoff) return '1 ноември'
  return 'Без избран ден'
}

export function formatStaffWhen(at: string) {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  return new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Sofia' }).format(date)
}

export interface StaffColumnFlags {
  email: string
  submitted: boolean
  withdrawn: boolean
  emailConfirmed: boolean
  notes: string
  role: string
  experience: string
  roundsFirst: number | null
  roundsRunoff: number | null
}

/** Columns win for the flags a volunteer save must not invent, and fill role or days when the payload never stored them. */
export function sealStaffProfile(profile: Profile, payload: string, row: StaffColumnFlags): Profile {
  let parsed: Partial<Profile> = {}
  try {
    parsed = JSON.parse(payload) as Partial<Profile>
  } catch {
    parsed = {}
  }
  const next: Profile = {
    ...profile,
    email: row.email,
    submitted: row.submitted,
    withdrawn: row.withdrawn,
    emailConfirmed: row.emailConfirmed,
    notes: row.notes || profile.notes,
  }
  if (!parsed.role) {
    const role = parseRoleChoice(row.role)
    if (role) next.role = role
  }
  if (!parsed.experience) {
    const experience = parseExperienceChoice(row.experience)
    if (experience) next.experience = experience
  }
  if (parsed.rounds == null && (row.roundsFirst != null || row.roundsRunoff != null)) {
    next.rounds = { first: row.roundsFirst === 1, runoff: row.roundsRunoff === 1 }
  }
  return next
}

export interface AdminPerson {
  id: string
  email: string
  firstName: string
  middleName: string
  lastName: string
  phone: string
  role: Role | null
  roundsFirst: boolean
  roundsRunoff: boolean
  experience: Experience | null
  town: string
  place: string
  home: HomePlace | null
  radius: Radius | null
  radiusLabel: string
  extraCityRegions: NamedPlace[]
  distantRegionCodes: string[]
  travelMunicipalities: TravelStop[]
  emailConfirmed: boolean
  submitted: boolean
  withdrawn: boolean
  imported: boolean
  draftSection: string
  publishedSection: string
  hasEgn: boolean
  notes: string
  callRequestedAt: string
  callMessage: string
  staffNote: string
  staffCalledAt: string
  staffCalledBy: string
  gap: string | null
}

export function buildAdminPerson(
  profile: Profile,
  extra: {
    id: string
    town: string
    place: string
    radius: string
    imported: boolean
    draftSection: string
    publishedSection: string
    hasEgn: boolean
    staffNote: string
    staffCalledAt: string
    staffCalledBy: string
  },
): AdminPerson {
  const radiusId = (profile.radius || extra.radius) as Radius | ''
  const known = radiusOptions(profile.place).find((option) => option.id === radiusId)
  return {
    id: extra.id,
    email: profile.email,
    firstName: profile.firstName,
    middleName: profile.middleName,
    lastName: profile.lastName,
    phone: profile.phone,
    role: profile.role,
    roundsFirst: profile.rounds.first,
    roundsRunoff: profile.rounds.runoff,
    experience: profile.experience,
    town: profile.place?.townName || extra.town,
    place: profile.place?.sectionPlace || extra.place,
    home: profile.place,
    radius: known?.id ?? null,
    radiusLabel: known?.label ?? '',
    extraCityRegions: profile.extraCityRegions ?? [],
    distantRegionCodes: profile.distantRegionCodes ?? [],
    travelMunicipalities: profile.travelMunicipalities ?? [],
    emailConfirmed: profile.emailConfirmed,
    submitted: profile.submitted,
    withdrawn: profile.withdrawn,
    imported: extra.imported,
    draftSection: extra.draftSection,
    publishedSection: extra.publishedSection,
    hasEgn: extra.hasEgn,
    notes: profile.notes,
    callRequestedAt: profile.callRequestedAt ?? '',
    callMessage: profile.callMessage,
    staffNote: extra.staffNote,
    staffCalledAt: extra.staffCalledAt,
    staffCalledBy: extra.staffCalledBy,
    gap: staffGapText(profile),
  }
}

/** Values a staff save may write. Email, submission and the national number stay in their own columns. */
export function staffWrite(profile: Profile, call: { at: string; by: string }, staffNote: string) {
  const columns = signupColumns(profile)
  return {
    role: columns.role,
    roundsFirst: columns.roundsFirst,
    roundsRunoff: columns.roundsRunoff,
    experience: columns.experience,
    radius: columns.radius,
    extraCityRegions: columns.extraCityRegions,
    distantRegionCodes: columns.distantRegionCodes,
    travelMunicipalities: columns.travelMunicipalities,
    payload: columns.payload,
    notes: columns.notes,
    staffNote: clipStaffText(staffNote, 4000),
    staffCalledAt: call.at,
    staffCalledBy: call.by,
  }
}

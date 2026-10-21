import { bgDate, ELECTION_DAY } from './election'
import type { HomePlace, Radius } from './model'

const PERSONAL_CODE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6}$/

export interface Partner {
  id: string
  name: string
  note: string
  href: string
}

export const PARTNERS: Record<string, Partner> = {
  'iaz.bg': {
    id: 'iaz.bg',
    name: 'Гюров, Кандев и аз',
    note: 'Идваш от iaz.bg. Работим заедно, а тук се записваш като пазител на вота.',
    href: 'https://iaz.bg',
  },
}

export function partnerFor(source: string | null) {
  if (!source) return null
  return PARTNERS[source.trim().toLowerCase()] ?? null
}

export function isPersonalReferral(code: string | null | undefined) {
  return Boolean(code && PERSONAL_CODE.test(code))
}

export function campaignFromSearch(params: URLSearchParams): { source: string | null; referredBy: string | null } {
  const sourceParam = params.get('source')?.trim().toLowerCase() || null
  const ref = params.get('ref')?.trim() || null
  if (sourceParam) return { source: sourceParam, referredBy: isPersonalReferral(ref) ? ref : null }
  if (ref && !isPersonalReferral(ref)) return { source: ref.toLowerCase(), referredBy: null }
  return { source: null, referredBy: ref }
}

/**
 * Birth date in an ЕГН as 'YYYY-MM-DD', or null when it is not a real date.
 * Month + 20 is the 1800s, month + 40 the 2000s, otherwise the 1900s. The checksum is not checked here.
 */
export function egnBirthDate(value: string): string | null {
  if (!/^\d{10}$/.test(value)) return null
  const yearPart = Number(value.slice(0, 2))
  let month = Number(value.slice(2, 4))
  const day = Number(value.slice(4, 6))
  let year = 1900 + yearPart
  if (month > 40) {
    month -= 40
    year = 2000 + yearPart
  } else if (month > 20) {
    month -= 20
    year = 1800 + yearPart
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return isoDay(year, month, day)
}

export function validEgn(value: string) {
  if (!egnBirthDate(value)) return false
  const digits = [...value].map(Number)
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = weights.reduce((total, weight, index) => total + weight * (digits[index] ?? 0), 0)
  const check = sum % 11 === 10 ? 0 : sum % 11
  return check === digits[9]
}

function isoDay(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The day someone born on `birthDate` turns `years`. A 29 February birthday falls on 28 February
 * in a common year (ЗЗД чл. 60, ал. 2: a term in years ends on the last day of the month when the date is missing).
 */
export function birthdayAt(birthDate: string, years: number) {
  const [year, month, day] = birthDate.split('-').map(Number) as [number, number, number]
  const target = year + years
  const lastDay = new Date(Date.UTC(target, month, 0)).getUTCDate()
  return isoDay(target, month, Math.min(day, lastDay))
}

/** 18 on or before election day: birthDate + 18 years <= electionDay. False for an ЕГН without a real date. */
export function adultOnElectionDay(egn: string, electionDay: string = ELECTION_DAY) {
  const born = egnBirthDate(egn)
  if (!born) return false
  return birthdayAt(born, 18) <= electionDay
}

/** For the person signing up. */
export const UNDERAGE_MESSAGE = `Трябва да навършиш 18 години до деня на изборите (${bgDate(ELECTION_DAY)} г.).`
/** For the team: an import row or an edit made for someone else. */
export const UNDERAGE_REASON = `не навършва 18 години до деня на изборите (${bgDate(ELECTION_DAY)} г.)`

const SOFIA_MIR: Record<string, '23' | '24' | '25'> = {
  витоша: '23',
  изгрев: '23',
  'красно село': '23',
  лозенец: '23',
  младост: '23',
  панчарево: '23',
  студентски: '23',
  триадица: '23',
  възраждане: '24',
  искър: '24',
  кремиковци: '24',
  оборище: '24',
  подуяне: '24',
  сердика: '24',
  слатина: '24',
  средец: '24',
  банкя: '25',
  връбница: '25',
  илинден: '25',
  'красна поляна': '25',
  люлин: '25',
  надежда: '25',
  'нови искър': '25',
  'овча купел': '25',
}

export function districtKey(name: string) {
  return name
    .replace(/район|р-н/giu, '')
    .replace(/[„“"]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('bg')
}

export function sofiaMir(name: string | undefined) {
  if (!name) return null
  return SOFIA_MIR[districtKey(name)] ?? null
}

export function mirOf(place: HomePlace | null) {
  if (!place || place.regionCode === '32') return null
  if (place.regionCode === 'sofia-merged') return sofiaMir(place.cityRegionName)
  return place.regionCode.padStart(2, '0')
}

export const LOCATION_LOCK_START = '2026-10-19'
export const LOCATION_LOCK_END = '2026-11-05'

export function locationEditable(assigned: boolean, now = new Date()) {
  if (!assigned) return true
  const iso = now.toISOString().slice(0, 10)
  return iso < LOCATION_LOCK_START || iso > LOCATION_LOCK_END
}

export function placeChangeAllowed(current: HomePlace | null, next: HomePlace | null, assigned: boolean) {
  if (!assigned || !current || !next) return true
  if (next.regionCode !== current.regionCode) return false
  if (current.regionCode !== 'sofia-merged') return true
  if (!next.cityRegionName) return true
  const from = mirOf(current)
  const to = mirOf(next)
  return Boolean(from && to && from === to)
}

export function machineOnlyPlace(place: HomePlace | null) {
  if (!place || place.paperCount == null || place.paperCount > 0) return false
  return Boolean(place.machineCount && place.machineCount > 0)
}

export function needsWiderTravel(place: HomePlace | null, radius: Radius | null) {
  if (!machineOnlyPlace(place)) return false
  return radius === 'cityRegion' || radius === 'nearby' || radius === 'settlement'
}

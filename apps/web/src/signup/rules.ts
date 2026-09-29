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

export function validEgn(value: string) {
  if (!/^\d{10}$/.test(value)) return false
  const digits = [...value].map(Number)
  let month = Number(value.slice(2, 4))
  const yearPart = Number(value.slice(0, 2))
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
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = weights.reduce((total, weight, index) => total + weight * (digits[index] ?? 0), 0)
  const check = sum % 11 === 10 ? 0 : sum % 11
  return check === digits[9]
}

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

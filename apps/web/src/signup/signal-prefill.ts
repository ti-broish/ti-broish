// /signal?name=…&email=…&oblast=…&origin=… pre-fills the public violation form.
// Partner organisations redirect people here with those GET parameters.
// ?origin= names the partner (whitelisted below): the page is co-branded and the origin is stored
// with the sent signal (signal_origins in D1, see signal-origin.ts).
import type { HomePlace } from './model'
import { IMPORT_REGIONS } from './partner-import-regions.data'
import { mapPlace, placeKey } from './partner-import'

export interface SignalSearch {
  name?: string
  email?: string
  oblast?: string
  origin?: SignalOrigin
}

/** Partners that may send people to /signal with ?origin=. Unknown values are ignored. */
export const SIGNAL_ORIGINS = ['iaz'] as const
export type SignalOrigin = (typeof SIGNAL_ORIGINS)[number]

/** A known ?origin= value („iaz“, any case, trimmed), or undefined. */
export function signalOrigin(value: unknown): SignalOrigin | undefined {
  if (typeof value !== 'string') return undefined
  const key = value.trim().toLowerCase()
  return (SIGNAL_ORIGINS as readonly string[]).includes(key) ? (key as SignalOrigin) : undefined
}

const NAME_MAX = 200
const EMAIL_MAX = 254
const OBLAST_MAX = 100
const ABROAD: HomePlace = { regionCode: '32', regionName: 'Извън страната' }
// Same as geo.ts SOFIA_CODES; geo.ts pulls in server functions.
const SOFIA_CODES = ['23', '24', '25']
const SOFIA_KEYS = new Set(['София', 'Sofia', 'Sofiya'].map(placeKey))
const ABROAD_KEYS = new Set(['Извън страната', 'Чужбина', 'Abroad'].map(placeKey))

function text(value: unknown, max: number) {
  // TanStack parses ?oblast=23 as the number 23.
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  if (!trimmed || trimmed.length > max) return undefined
  return trimmed
}

/** Route search for /signal. Anything else, or a wrong type, is dropped. */
export function parseSignalSearch(search: Record<string, unknown>): SignalSearch {
  const name = text(search.name, NAME_MAX)
  const email = text(search.email, EMAIL_MAX)?.replace(/\s/g, '')
  const oblast = text(search.oblast, OBLAST_MAX)
  const origin = signalOrigin(search.origin)
  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(oblast ? { oblast } : {}),
    ...(origin ? { origin } : {}),
  }
}

/**
 * The oblast select value for ?oblast=: an election region code („23“, „5“, „05“, „32“),
 * the form's own value („sofia-merged“) or the name („София“, „Благоевград“, „Plovdiv“).
 * София-град is 23, 24 and 25 merged; plain „Пловдив“ is the oblast (17), as in the partner import.
 * Unknown values give null.
 */
export function oblastPlace(value: string | undefined): HomePlace | null {
  const raw = value?.trim()
  if (!raw) return null
  if (/^\d{1,2}$/.test(raw)) {
    const code = raw.padStart(2, '0')
    if (code === '32') return { ...ABROAD }
    const lookup = SOFIA_CODES.includes(code) ? 'sofia-merged' : code
    const region = IMPORT_REGIONS.find((item) => item.code === lookup)
    return region ? { regionCode: region.code, regionName: region.name } : null
  }
  const byCode = IMPORT_REGIONS.find((item) => item.code === raw)
  if (byCode) return { regionCode: byCode.code, regionName: byCode.name }
  const key = placeKey(raw)
  if (!key) return null
  if (SOFIA_KEYS.has(key)) return oblastPlace('sofia-merged')
  if (ABROAD_KEYS.has(key)) return { ...ABROAD }
  const mapped = mapPlace(raw, '').place
  return mapped ? { regionCode: mapped.regionCode, regionName: mapped.regionName } : null
}

/** Profile place wins when it is in the same oblast (it may already have the town); otherwise the link's oblast. */
export function mergePlace(fromLink: HomePlace | null, fromProfile: HomePlace | null): HomePlace | null {
  if (!fromLink) return fromProfile
  if (fromProfile && fromProfile.regionCode === fromLink.regionCode) return fromProfile
  return fromLink
}

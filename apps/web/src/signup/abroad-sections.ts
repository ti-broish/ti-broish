// The abroad sections (МИР 32) with their street addresses, from GET /sections/abroad of the old API
// (api.tibroish.bg, d1tapi.tibroish.bg on staging; src/signup/api-base.ts). The API keeps the addresses
// from the МВнР table, so an address change needs no deploy here. Every colo keeps a copy for 10 minutes
// and serves it for a day while it refreshes; if the API is down past that, the last copy this isolate
// saw is used. With no copy at all loadAbroadSections throws, so a caller can stop rather than send blanks.
// The admin route files reach this module too, so it imports nothing server-only (no *.server module and
// no cloudflare:workers): callers pass waitUntil when they have one.
import { cachedSnapshot } from '../home/snapshot-cache'
import { tibroishApi } from './api-base'

/** One abroad section as the site uses it. */
export type AbroadSection = {
  id: string
  /** Committee name from the CIK list: the city, „Посолство“, „Баркинг 2“. */
  place: string
  town: string
  country: string
  /** Street address; '' when the API has none (never invented). */
  address: string
  /** „Канбера (Посолство)“, „Тромсьо“: the town with the committee name when that says more. */
  label: string
}

export type AbroadSections = { sections: Record<string, AbroadSection>; fetchedAt: number }

type Fetcher = (url: string) => Promise<Response>
type WaitUntil = (promise: Promise<unknown>) => void

export const ABROAD_SECTIONS_TTL = { freshMs: 10 * 60_000, staleMs: 24 * 60 * 60_000 }

const defaultFetcher: Fetcher = (url) =>
  fetch(url, { headers: { accept: 'application/json', 'accept-language': 'bg-BG' }, signal: AbortSignal.timeout(15_000) })

const clean = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()

export function abroadLabel(town: string, place: string) {
  if (!place || place === town) return town
  if (!town || place.includes(town)) return place
  return `${town} (${place})`
}

/** The /sections/abroad answer as a map by code. Throws on anything that is not a list of sections. */
export function parseAbroadSections(payload: unknown, fetchedAt = Date.now()): AbroadSections {
  if (!Array.isArray(payload)) throw new Error('/sections/abroad: not a list')
  const sections: Record<string, AbroadSection> = {}
  for (const item of payload as Array<Record<string, unknown>>) {
    const id = clean(item?.id).replace(/\D/g, '')
    if (!/^32\d{7}$/.test(id)) continue
    const town = clean((item.town as { name?: unknown } | undefined)?.name)
    const place = clean(item.place)
    sections[id] = {
      id,
      place,
      town,
      country: clean((item.country as { name?: unknown } | undefined)?.name),
      address: clean(item.address),
      label: abroadLabel(town, place),
    }
  }
  if (Object.keys(sections).length === 0) throw new Error('/sections/abroad: no sections')
  return { sections, fetchedAt }
}

let lastGood: AbroadSections | null = null

/** Every abroad section by code, cached (see the top of this file). Throws only when no copy exists at all. */
export async function loadAbroadSections(
  options: { fetcher?: Fetcher; waitUntil?: WaitUntil; now?: number } = {},
): Promise<AbroadSections> {
  const api = tibroishApi()
  const fetcher = options.fetcher ?? defaultFetcher
  const load = async () => {
    const response = await fetcher(`${api}/sections/abroad`)
    if (!response.ok) throw new Error(`API ${response.status} for /sections/abroad`)
    return parseAbroadSections(await response.json())
  }
  try {
    // Without a waitUntil the background refresh of a stale copy still runs while the request lasts;
    // if it is cut short, the next request after 10 minutes refreshes again.
    const loaded = await cachedSnapshot(
      `${api}/sections/abroad`,
      load,
      options.waitUntil ?? ((promise) => void promise),
      options.now ?? Date.now(),
      ABROAD_SECTIONS_TTL,
    )
    lastGood = loaded
    return loaded
  } catch (error) {
    if (lastGood) return lastGood
    throw error
  }
}

/** Like loadAbroadSections, but null instead of throwing (for callers where a blank is harmless). */
export async function loadAbroadSectionsOrNull(options: Parameters<typeof loadAbroadSections>[0] = {}) {
  try {
    return await loadAbroadSections(options)
  } catch (error) {
    console.warn('abroad sections unavailable', JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    return null
  }
}

/** One abroad section by a code in any spacing, if known. */
export function abroadSectionOf(sections: AbroadSections | null | undefined, code: string): AbroadSection | undefined {
  const digits = String(code ?? '').replace(/\D/g, '')
  if (!/^32\d{7}$/.test(digits)) return undefined
  return sections?.sections[digits]
}

/** Test hook: forget the last good copy. */
export function resetAbroadSectionsForTest() {
  lastGood = null
}

export const ABROAD_SECTIONS_UNAVAILABLE =
  'Адресите на секциите в чужбина не се заредиха от API, затова нищо не е направено. Опитай пак след малко.'

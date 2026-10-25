// Results units, the election meta and one published signal, fetched by the worker from api.tibroish.bg
// (d1tapi.tibroish.bg on staging, src/signup/api-base.ts) and cached per colo like /api/violations.
import { UPSTREAM, cachedSnapshot } from './violations.server'
import { validUnit, type ElectionMeta, type PublicViolation, type ResultsUnit } from './results'
import { validAfter } from './violations'

type Fetcher = (url: string) => Promise<Response>
type WaitUntil = (promise: Promise<unknown>) => void

export type Loaded<T> = { data: T | null; fetchedAt: number }

const apiFetcher: Fetcher = (url) => fetch(url, { headers: { accept: 'application/json', 'accept-language': 'bg-BG' } })

// The e2e dev server answers from fixed data (results-fixtures.ts); production builds drop this branch.
const fixtureFetcher: Fetcher = async (url) => {
  const { FIXTURES } = await import('./results-fixtures')
  const unit = /\/results\/([^/]+)\.json$/.exec(url)?.[1]
  const data = unit ? FIXTURES[unit] : undefined
  return data ? Response.json(data) : new Response('not found', { status: 404 })
}

const FIXTURES_ON = import.meta.env.VITE_RESULTS_FIXTURES === '1'
const defaultFetcher: Fetcher = FIXTURES_ON ? fixtureFetcher : apiFetcher
// The local cache outlives a dev server, so fixed data must never share keys with real API answers.
const cacheKey = (path: string) => `${UPSTREAM}${path}${FIXTURES_ON ? '?fixtures=1' : ''}`

async function getJson<T>(fetcher: Fetcher, path: string): Promise<Loaded<T>> {
  const response = await fetcher(`${UPSTREAM}${path}`)
  // A unit or signal that does not exist is cached as missing, so a bad link does not hit the API every time.
  if (response.status === 404 || response.status === 403 || response.status === 400) return { data: null, fetchedAt: Date.now() }
  if (!response.ok) throw new Error(`API ${response.status} for ${path}`)
  return { data: (await response.json()) as T, fetchedAt: Date.now() }
}

/** GET /results/<unit>.json (index for the country, meta for the election). Null when the unit does not exist. */
export async function loadUnit(unit: string, waitUntil: WaitUntil, fetcher: Fetcher = defaultFetcher): Promise<ResultsUnit | null> {
  if (!validUnit(unit) || unit === 'meta') return null
  const path = `/results/${unit}.json`
  const loaded = await cachedSnapshot(cacheKey(path), () => getJson<ResultsUnit>(fetcher, path), waitUntil)
  return loaded.data
}

export async function loadMeta(waitUntil: WaitUntil, fetcher: Fetcher = defaultFetcher): Promise<ElectionMeta | null> {
  const path = '/results/meta.json'
  const loaded = await cachedSnapshot(cacheKey(path), () => getJson<ElectionMeta>(fetcher, path), waitUntil)
  return loaded.data
}

/** Only the fields the public signal page shows; never the description or contact details. */
export function publicViolation(raw: Record<string, unknown>): PublicViolation {
  const value = raw as unknown as PublicViolation & { pictures?: { url?: string }[] }
  const town = value.town
  return {
    id: String(value.id),
    statusLocalized: value.statusLocalized ?? null,
    publishedText: value.publishedText ?? null,
    createdAt: value.createdAt ?? null,
    section: value.section?.id
      ? {
          id: value.section.id,
          electionRegion: value.section.electionRegion
            ? { code: value.section.electionRegion.code, name: value.section.electionRegion.name }
            : null,
        }
      : null,
    town: town
      ? {
          name: town.name,
          country: town.country ? { name: town.country.name } : null,
          municipality: town.municipality
            ? {
                name: town.municipality.name,
                electionRegions: (town.municipality.electionRegions ?? []).map((region) => ({ code: region.code, name: region.name })),
              }
            : null,
        }
      : null,
    pictures: (value.pictures ?? []).filter((picture) => typeof picture?.url === 'string').map((picture) => ({ url: picture.url as string })),
  }
}

/** GET /violations/<id> without a secret: the API answers only for published signals. */
export async function loadViolation(id: string, waitUntil: WaitUntil, fetcher: Fetcher = defaultFetcher): Promise<PublicViolation | null> {
  if (!validAfter(id)) return null
  const path = `/violations/${id}`
  const loaded = await cachedSnapshot(
    `${UPSTREAM}${path}`,
    async () => {
      const raw = await getJson<Record<string, unknown>>(fetcher, path)
      return { data: raw.data && raw.data.publishedText ? publicViolation(raw.data) : null, fetchedAt: raw.fetchedAt }
    },
    waitUntil,
  )
  return loaded.data
}

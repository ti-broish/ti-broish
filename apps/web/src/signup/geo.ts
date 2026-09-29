import { createServerFn } from '@tanstack/react-start'
import type { Geometry } from 'geojson'
import { chooseDistrictOutline, districtLabel, keepDistrictGeometry, nominatimSearchQuery } from './outlines'

const API = 'https://api.tibroish.bg'

export interface Municipality {
  code: string
  name: string
}

export interface ElectionRegion {
  code: string
  name: string
  isAbroad?: boolean
  municipalities?: Municipality[]
}

export interface CityRegion {
  code: string
  name: string
}

export interface Town {
  id: number
  name: string
  cityRegions: CityRegion[]
}

export interface PollingSection {
  id: string
  place: string
  votersCount?: number | null
  isMachine?: boolean | null
}

export interface Country {
  code: string
  name: string
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}/${path}`, {
    headers: { Accept: 'application/json', 'Accept-Language': 'bg-BG' },
  })
  if (!response.ok) throw new Error(`Грешка при зареждане (${response.status})`)
  return response.json() as Promise<T>
}

export const fetchRegions = createServerFn({ method: 'GET' }).handler(async () => {
  return getJson<ElectionRegion[]>('election_regions')
})

export const fetchCountries = createServerFn({ method: 'GET' }).handler(async () => {
  return getJson<Country[]>('countries')
})

export const fetchTowns = createServerFn({ method: 'POST' })
  .validator((input: { regionCodes: string[]; municipalityCode: string }) => input)
  .handler(async ({ data }) => {
    const lists = await Promise.all(
      data.regionCodes.map((code) =>
        getJson<Town[]>(
          `towns?country=000&election_region=${encodeURIComponent(code)}&municipality=${encodeURIComponent(data.municipalityCode)}`,
        ),
      ),
    )
    const merged = new Map<number, Town>()
    for (const list of lists) {
      for (const town of list) {
        const existing = merged.get(town.id)
        if (!existing) {
          merged.set(town.id, { ...town, cityRegions: [...(town.cityRegions ?? [])] })
          continue
        }
        for (const region of town.cityRegions ?? []) {
          if (!existing.cityRegions.some((item) => item.code === region.code)) existing.cityRegions.push(region)
        }
      }
    }
    return [...merged.values()]
  })

export const fetchSections = createServerFn({ method: 'POST' })
  .validator((input: { townId: number; cityRegionCode?: string }) => input)
  .handler(async ({ data }) => {
    const query = data.cityRegionCode
      ? `sections?town=${data.townId}&city_region=${encodeURIComponent(data.cityRegionCode)}`
      : `sections?town=${data.townId}`
    const rows = await getJson<Array<PollingSection & { voters_count?: number; is_machine?: boolean }>>(query)
    return rows.map((row) => ({
      id: String(row.id),
      place: row.place,
      votersCount: typeof row.votersCount === 'number' ? row.votersCount : typeof row.voters_count === 'number' ? row.voters_count : null,
      isMachine: typeof row.isMachine === 'boolean' ? row.isMachine : typeof row.is_machine === 'boolean' ? row.is_machine : null,
    }))
  })

export interface GeocodeHit {
  lat: number
  lng: number
  category: string
  type: string
  geojson: Geometry | null
}

const geocodeCache = new Map<string, GeocodeHit | null>()
let geocodeNextAt = 0
let geocodeHighAt = 0

/** Nominatim allows about one request a second. The wait stays on this request so a shared queue cannot leave it without a timer. */
function reserveGeocodeSlot(priority: 'high' | 'low') {
  const now = Date.now()
  const start = priority === 'high' ? Math.max(now, geocodeHighAt) : Math.max(now, geocodeNextAt, geocodeHighAt)
  const next = start + 1100
  if (priority === 'high') geocodeHighAt = next
  geocodeNextAt = Math.max(geocodeNextAt, next)
  return start - now
}

type NominatimRow = {
  lat?: string
  lon?: string
  name?: string
  class?: string
  category?: string
  type?: string
  addresstype?: string
  place_rank?: number
  boundingbox?: string[]
  geojson?: Geometry
}

function outlineOf(row: NominatimRow) {
  const shape = row.geojson
  return shape && (shape.type === 'Polygon' || shape.type === 'MultiPolygon') ? shape : null
}

function adminSpan(row: NominatimRow) {
  if (!outlineOf(row)) return 0
  const kind = `${row.category ?? ''} ${row.class ?? ''} ${row.type ?? ''}`
  if (!/boundary|administrative/.test(kind)) return 0
  const box = row.boundingbox
  if (!box || box.length < 4) return 0
  return Math.abs(Number(box[1]) - Number(box[0])) * Math.abs(Number(box[3]) - Number(box[2]))
}

function pickRow(rows: NominatimRow[], scope: 'broad' | 'local' | null) {
  if (!scope) return rows[0]
  const areas = rows.filter((row) => adminSpan(row) > 0)
  if (areas.length === 0) return rows.find((row) => outlineOf(row)) ?? rows[0]
  areas.sort((a, b) => adminSpan(a) - adminSpan(b))
  return scope === 'broad' ? areas[areas.length - 1] : areas[0]
}

function pickDistrict(rows: NominatimRow[], query: string) {
  const chosen = chooseDistrictOutline(
    query,
    rows.map((row) => ({
      row,
      name: row.name ?? null,
      category: row.category ?? row.class ?? null,
      type: row.type ?? null,
      addressType: row.addresstype ?? null,
      rank: typeof row.place_rank === 'number' ? row.place_rank : null,
      geometry: outlineOf(row),
    })),
  )
  return chosen?.row
}

async function searchNominatim(query: string, abroad: boolean, polygon: boolean, scope: 'broad' | 'local' | null, priority: 'high' | 'low') {
  const q = nominatimSearchQuery(query)
  const district = Boolean(districtLabel(query))
  const key = `${polygon ? 'p' : 'q'}:${scope ?? '-'}:${abroad ? 'a' : 'bg'}:${q}`
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null
  const wait = reserveGeocodeSlot(priority)
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', q)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', polygon ? '5' : '1')
    if (!abroad) url.searchParams.set('countrycodes', 'bg')
    if (polygon) url.searchParams.set('polygon_geojson', '1')
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'bg',
        'User-Agent': 'ti-broish-staging/1.0 (team@tibroish.bg)',
      },
    })
    let hit: GeocodeHit | null = null
    let cacheable = true
    if (response.ok) {
      const rows = (await response.json()) as NominatimRow[]
      const row = district && polygon ? pickDistrict(rows, query) : pickRow(rows, polygon ? scope : null)
      if (row?.lat && row.lon) {
        const geometry = district ? keepDistrictGeometry(query, outlineOf(row)) : outlineOf(row)
        hit = {
          lat: Number(row.lat),
          lng: Number(row.lon),
          category: row.category ?? row.class ?? '',
          type: row.type ?? '',
          geojson: geometry,
        }
      }
      if (district && polygon && !hit?.geojson) cacheable = false
    } else if (district && polygon) {
      cacheable = false
    }
    if (cacheable) geocodeCache.set(key, hit)
    return hit
  } catch {
    return null
  }
}

export const geocodePlace = createServerFn({ method: 'POST' })
  .validator((input: { query: string; abroad?: boolean; polygon?: boolean; scope?: 'broad' | 'local'; priority?: 'high' | 'low' }) => input)
  .handler(async ({ data }) =>
    searchNominatim(data.query, Boolean(data.abroad), Boolean(data.polygon), data.scope ?? null, data.priority === 'high' ? 'high' : 'low'),
  )

export const SOFIA_CODES = ['23', '24', '25']

export function displayRegions(regions: ElectionRegion[]): ElectionRegion[] {
  const sofia = regions.filter((region) => SOFIA_CODES.includes(region.code))
  const rest = regions.filter((region) => !SOFIA_CODES.includes(region.code))
  if (sofia.length < 2) return [...regions].sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  const seen = new Set<string>()
  const municipalities: Municipality[] = []
  for (const region of sofia) {
    for (const municipality of region.municipalities ?? []) {
      if (seen.has(municipality.code)) continue
      seen.add(municipality.code)
      municipalities.push(municipality)
    }
  }
  municipalities.sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  const merged: ElectionRegion = { code: 'sofia-merged', name: 'София-град', municipalities }
  return [...rest, merged].sort((a, b) => a.name.localeCompare(b.name, 'bg'))
}

export function apiRegionCodes(region: ElectionRegion | undefined) {
  if (!region) return []
  return region.code === 'sofia-merged' ? SOFIA_CODES : [region.code]
}

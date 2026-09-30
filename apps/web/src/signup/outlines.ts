import type { Geometry } from 'geojson'

export interface OutlineCandidate {
  name?: string | null
  category?: string | null
  type?: string | null
  addressType?: string | null
  rank?: number | null
  geometry: Geometry | null
}

// Sofia is about 0.31° × 0.45°. Панчарево is about 0.30° × 0.38°, Кремиковци 0.19° × 0.33°,
// Нови Искър 0.18° × 0.26°. A 0.2° / 0.25° cap dropped those райони.
const MAX_DISTRICT_LAT = 0.36
const MAX_DISTRICT_LNG = 0.42

export function districtLabel(query: string) {
  if (!query.startsWith('район ')) return null
  const name = (query.split(',')[0] ?? '').slice('район '.length).trim()
  return name || null
}

function placeKey(value: string) {
  return value.trim().toLocaleLowerCase('bg').replace(/^район\s+/u, '')
}

export function outlineSpan(geometry: Geometry | null) {
  if (!geometry || !('coordinates' in geometry)) return null
  const points: number[][] = []
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push(value as number[])
      return
    }
    for (const item of value) walk(item)
  }
  walk(geometry.coordinates)
  if (points.length === 0) return null
  let south = 90
  let north = -90
  let west = 180
  let east = -180
  for (const pair of points) {
    const lng = pair[0] ?? 0
    const lat = pair[1] ?? 0
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }
  return { lat: north - south, lng: east - west }
}

function wideAsCity(geometry: Geometry) {
  const span = outlineSpan(geometry)
  if (!span) return true
  return span.lat > MAX_DISTRICT_LAT || span.lng > MAX_DISTRICT_LNG
}

/** "район X" is the town hall. A repeated town name hides the boundary. "Пловдив град" matches nothing. */
export function nominatimSearchQuery(query: string) {
  const district = districtLabel(query)
  if (!district) return query
  const body = query
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(1)
    .map((part) => part.replace(/ град$/u, ''))
    .filter((part) => placeKey(part) !== placeKey(district))
  return [district, ...body].join(', ')
}

function districtRank(candidate: OutlineCandidate) {
  const rank = candidate.rank
  if (typeof rank === 'number' && rank >= 11 && rank <= 14) return 0
  const kind = `${candidate.type ?? ''} ${candidate.addressType ?? ''} ${candidate.category ?? ''}`
  if (/suburb|city_district|borough|county/.test(kind)) return 1
  if (/administrative|boundary/.test(kind)) return 2
  return 3
}

function polygon(geometry: Geometry | null): geometry is Geometry {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon'
}

export function chooseDistrictOutline<T extends OutlineCandidate>(query: string, candidates: readonly T[]): T | null {
  const district = districtLabel(query)
  if (!district) return null
  const wanted = placeKey(district)
  const matches = candidates.filter((candidate) => {
    if (!polygon(candidate.geometry) || !candidate.name) return false
    if (placeKey(candidate.name) !== wanted) return false
    if (candidate.category === 'amenity' || candidate.type === 'townhall') return false
    return !wideAsCity(candidate.geometry)
  })
  matches.sort((a, b) => {
    const rank = districtRank(a) - districtRank(b)
    if (rank !== 0) return rank
    const aSpan = outlineSpan(a.geometry)
    const bSpan = outlineSpan(b.geometry)
    return (bSpan ? bSpan.lat * bSpan.lng : 0) - (aSpan ? aSpan.lat * aSpan.lng : 0)
  })
  return matches[0] ?? null
}

export function keepDistrictGeometry(query: string, geometry: Geometry | null) {
  if (!geometry || !districtLabel(query)) return geometry
  if (!polygon(geometry) || wideAsCity(geometry)) return null
  return geometry
}

/** Chosen districts frame the map. While a choice is still loading, other districts stay out of the frame. */
export function frameAreas<T extends { selected?: boolean }>(areas: readonly T[], fitSelected = false): T[] {
  const chosen: T[] = []
  for (const item of areas) {
    if (item.selected === true) chosen.push(item)
  }
  if (chosen.length > 0 || fitSelected) return chosen
  return [...areas]
}

/** A missing entry and a stored rejection both mean "fetch again", not an empty highlight. */
export function cachedOutlineAreas(
  cache: ReadonlyMap<string, Geometry | null>,
  queries: ReadonlyArray<{ id: string; scope: string; query: string }>,
) {
  const areas: Array<{ id: string; geometry: Geometry }> = []
  for (const item of queries) {
    const geometry = cache.get(`${item.scope}:${item.query}`)
    if (!geometry) return null
    areas.push({ id: item.id, geometry })
  }
  return areas
}

export function storeOutline(cache: Map<string, Geometry | null>, key: string, geometry: Geometry | null) {
  if (!geometry) return
  cache.set(key, geometry)
}

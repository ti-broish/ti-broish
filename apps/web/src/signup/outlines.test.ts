import { describe, expect, it } from 'vitest'
import type { Geometry } from 'geojson'
import {
  cachedOutlineAreas,
  chooseDistrictOutline,
  frameAreas,
  nominatimSearchQuery,
  outlineSpan,
  storeOutline,
  type OutlineCandidate,
} from './outlines'

function box(south: number, west: number, north: number, east: number): Geometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  }
}

function hit(name: string, geometry: Geometry, patch: Partial<OutlineCandidate> = {}): OutlineCandidate {
  return {
    name,
    geometry,
    category: 'boundary',
    type: 'administrative',
    addressType: 'county',
    rank: 12,
    ...patch,
  }
}

const city = hit('София', box(42.4, 23, 42.88, 23.63), { addressType: 'city', rank: 15 })
const mladost = hit('Младост', box(42.64, 23.36, 42.69, 23.42))
const pancharevo = hit('Панчарево', box(42.5, 23.2, 42.8, 23.58), { addressType: 'village' })
const pancharevoVillage = hit('Панчарево', box(42.6, 23.4, 42.67, 23.47), { addressType: 'village', rank: 16 })

describe('city region outlines', () => {
  it('does not keep a whole-city polygon when a smaller district is available', () => {
    const query = 'район Младост, София, София-град, България'
    const chosen = chooseDistrictOutline(query, [city, mladost])
    expect(chosen?.geometry).toBe(mladost.geometry)
    expect(chosen?.geometry).not.toBe(city.geometry)
    expect(nominatimSearchQuery(query)).toBe('Младост, София, София-град, България')
  })

  it('keeps a large district that is still not the city', () => {
    const query = 'район Панчарево, Панчарево, София-град, България'
    expect(outlineSpan(pancharevo.geometry)?.lat).toBeGreaterThan(0.2)
    const chosen = chooseDistrictOutline(query, [city, pancharevoVillage, pancharevo])
    expect(chosen?.geometry).toBe(pancharevo.geometry)
    expect(nominatimSearchQuery(query)).toBe('Панчарево, София-град, България')
    expect(nominatimSearchQuery('район Банкя, Банкя, София-град, България')).toBe('Банкя, София-град, България')
    expect(nominatimSearchQuery('район Тракия, Пловдив, Пловдив град, България')).toBe('Тракия, Пловдив, Пловдив, България')
  })

  it('does not treat a cached rejection as a finished empty highlight', () => {
    const query = { id: 'district:15', scope: 'local', query: 'район Младост, София, София-град, България' }
    const key = `${query.scope}:${query.query}`
    const cache = new Map<string, Geometry | null>()
    cache.set(key, null)
    expect(cachedOutlineAreas(cache, [query])).toBeNull()
    storeOutline(cache, key, null)
    expect(cachedOutlineAreas(cache, [query])).toBeNull()
    storeOutline(cache, key, mladost.geometry)
    expect(cachedOutlineAreas(cache, [query])).toEqual([{ id: query.id, geometry: mladost.geometry }])
    expect(cachedOutlineAreas(cache, [query])).toEqual([{ id: query.id, geometry: mladost.geometry }])
    storeOutline(cache, key, null)
    expect(cachedOutlineAreas(cache, [query])).toEqual([{ id: query.id, geometry: mladost.geometry }])
  })

  it('frames the chosen district and keeps the whole city when nothing is chosen', () => {
    const areas = [
      { id: 'district:11', selected: false },
      { id: 'district:15', selected: true },
      { id: 'district:09', selected: false },
    ]
    expect(frameAreas(areas).map((item) => item.id)).toEqual(['district:15'])
    expect(frameAreas(areas.map((item) => ({ ...item, selected: false }))).map((item) => item.id)).toEqual(['district:11', 'district:15', 'district:09'])
    expect(frameAreas(areas.map((item) => ({ ...item, selected: false })), true)).toEqual([])
    const town: Array<{ id: string; selected?: boolean }> = [{ id: 'town' }]
    expect(frameAreas(town).map((item) => item.id)).toEqual(['town'])
  })
})

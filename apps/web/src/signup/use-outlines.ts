import { useEffect, useRef, useState } from 'react'
import type { Geometry } from 'geojson'
import { geocodePlace } from './geo'
import type { OutlineRequest } from './model'
import { cachedOutlineAreas, keepDistrictGeometry, storeOutline } from './outlines'

export interface MapArea {
  id: string
  geometry: Geometry
  selected?: boolean
}

const geometryCache = new Map<string, Geometry | null>()
const pointCache = new Map<string, { lat: number; lng: number }>()

function cacheKey(item: OutlineRequest) {
  return `${item.scope}:${item.query}`
}

function chosenFirst<T extends { selected?: boolean }>(items: readonly T[]) {
  return [...items.filter((item) => item.selected), ...items.filter((item) => !item.selected)]
}

function focusFor(queries: OutlineRequest[]) {
  const selecting = queries.some((item) => item.selected)
  for (const item of chosenFirst(queries)) {
    const point = pointCache.get(cacheKey(item))
    if (!point) continue
    if (item.selected || !selecting) return { ...point, zoom: item.abroad ? 11 : 14 }
  }
  return null
}

function areasFromCache(queries: OutlineRequest[]): MapArea[] {
  const areas: MapArea[] = []
  for (const item of queries) {
    const geometry = geometryCache.get(cacheKey(item))
    if (!geometry) continue
    areas.push({ id: item.id, geometry, selected: item.selected })
  }
  return areas
}

function remembered(queries: OutlineRequest[]) {
  const cached = cachedOutlineAreas(geometryCache, queries)
  if (!cached) return null
  const areas = cached.map((area) => ({
    ...area,
    selected: queries.find((item) => item.id === area.id)?.selected,
  }))
  return { areas, focus: focusFor(queries) }
}

export function useOutlines(queries: OutlineRequest[]) {
  const key = queries.map((item) => `${item.id}:${item.scope}:${item.selected ? '1' : '0'}:${item.query}`).join('|')
  const abroad = queries.some((item) => item.abroad)
  const initial = remembered(queries)
  const [areas, setAreas] = useState<MapArea[]>(initial?.areas ?? [])
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom: number } | null>(initial?.focus ?? null)
  const latest = useRef(queries)
  latest.current = queries

  useEffect(() => {
    const pending = latest.current
    if (pending.length === 0) {
      setAreas([])
      setFocus(null)
      return
    }
    const cached = remembered(pending)
    if (cached) {
      setAreas(cached.areas)
      setFocus(cached.focus)
      return
    }
    setAreas(areasFromCache(pending))
    setFocus(focusFor(pending))
    let cancelled = false
    const selecting = pending.some((item) => item.selected)
    const handle = window.setTimeout(() => {
      void (async () => {
        for (const item of chosenFirst(pending)) {
          const key = cacheKey(item)
          if (geometryCache.get(key) && pointCache.has(key)) continue
          const priority = item.selected || !selecting ? 'high' : 'low'
          let quick: { lat: number; lng: number } | null = null
          let hit: { lat: number; lng: number; geojson: Geometry | null } | null = null
          try {
            quick = await geocodePlace({
              data: { query: item.query, abroad: item.abroad, polygon: false, scope: item.scope, priority },
            })
            hit = await geocodePlace({
              data: { query: item.query, abroad: item.abroad, polygon: true, scope: item.scope, priority },
            })
          } catch {
            continue
          }
          if (quick) pointCache.set(key, { lat: quick.lat, lng: quick.lng })
          const geometry = keepDistrictGeometry(item.query, hit?.geojson ?? null)
          if (geometry) {
            storeOutline(geometryCache, key, geometry)
            if (hit) pointCache.set(key, { lat: hit.lat, lng: hit.lng })
          } else if (hit && !pointCache.has(key)) {
            pointCache.set(key, { lat: hit.lat, lng: hit.lng })
          }
          if (cancelled) return
          setAreas(areasFromCache(pending))
          const nextFocus = focusFor(pending)
          if (nextFocus) setFocus(nextFocus)
        }
      })()
    }, abroad ? 400 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [abroad, key])

  return { areas, focus, selecting: queries.some((item) => item.selected) }
}

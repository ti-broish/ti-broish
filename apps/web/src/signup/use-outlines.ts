import { useEffect, useRef, useState } from 'react'
import type { Geometry } from 'geojson'
import { geocodePlace } from './geo'
import type { OutlineRequest } from './model'
import { cachedOutlineAreas, keepDistrictGeometry, storeOutline } from './outlines'

export interface MapArea {
  id: string
  geometry: Geometry
}

const geometryCache = new Map<string, Geometry | null>()
const pointCache = new Map<string, { lat: number; lng: number }>()

function remembered(queries: OutlineRequest[]) {
  const areas = cachedOutlineAreas(geometryCache, queries)
  if (!areas) return null
  let focus: { lat: number; lng: number; zoom: number } | null = null
  for (const item of queries) {
    const point = pointCache.get(`${item.scope}:${item.query}`)
    if (point && !focus) focus = { ...point, zoom: item.abroad ? 11 : 14 }
  }
  return { areas, focus }
}

export function useOutlines(queries: OutlineRequest[]) {
  const key = queries.map((item) => `${item.id}:${item.scope}:${item.query}`).join('|')
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
    setAreas([])
    let cancelled = false
    const handle = window.setTimeout(() => {
      void (async () => {
        const next: MapArea[] = []
        let point: { lat: number; lng: number } | null = null
        for (const item of pending) {
          const cacheKey = `${item.scope}:${item.query}`
          const quick = await geocodePlace({
            data: { query: item.query, abroad: item.abroad, polygon: false, scope: item.scope, priority: 'high' },
          })
          if (quick) {
            const focusPoint = { lat: quick.lat, lng: quick.lng }
            pointCache.set(cacheKey, focusPoint)
            point ??= focusPoint
            if (!cancelled) setFocus({ ...point, zoom: item.abroad ? 11 : 14 })
          }
          const hit = await geocodePlace({
            data: { query: item.query, abroad: item.abroad, polygon: true, scope: item.scope, priority: 'high' },
          })
          const geometry = keepDistrictGeometry(item.query, hit?.geojson ?? null)
          if (geometry) {
            storeOutline(geometryCache, cacheKey, geometry)
            if (hit) pointCache.set(cacheKey, { lat: hit.lat, lng: hit.lng })
          }
          if (cancelled) return
          if (hit && !point) {
            point = { lat: hit.lat, lng: hit.lng }
            pointCache.set(cacheKey, point)
            setFocus({ ...point, zoom: item.abroad ? 11 : 14 })
          }
          if (geometry) next.push({ id: item.id, geometry })
          setAreas([...next])
        }
      })()
    }, abroad ? 400 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [abroad, key])

  return { areas, focus }
}

import { useEffect, useRef, useState } from 'react'
import type { Geometry } from 'geojson'
import { geocodePlace } from './geo'
import type { OutlineRequest } from './model'

export interface MapArea {
  id: string
  geometry: Geometry
}

const geometryCache = new Map<string, Geometry | null>()
const pointCache = new Map<string, { lat: number; lng: number }>()

function remembered(queries: OutlineRequest[]) {
  const areas: MapArea[] = []
  let focus: { lat: number; lng: number; zoom: number } | null = null
  for (const item of queries) {
    if (!geometryCache.has(`${item.scope}:${item.query}`)) return null
    const geometry = geometryCache.get(`${item.scope}:${item.query}`)
    const point = pointCache.get(`${item.scope}:${item.query}`)
    if (geometry) areas.push({ id: item.id, geometry })
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
    let cancelled = false
    const handle = window.setTimeout(() => {
      void (async () => {
        const next: MapArea[] = []
        let point: { lat: number; lng: number } | null = null
        for (const item of pending) {
          const hit = await geocodePlace({
            data: { query: item.query, abroad: item.abroad, polygon: true, scope: item.scope, priority: 'high' },
          })
          if (cancelled) return
          const cacheKey = `${item.scope}:${item.query}`
          geometryCache.set(cacheKey, hit?.geojson ?? null)
          if (hit) pointCache.set(cacheKey, { lat: hit.lat, lng: hit.lng })
          if (!hit) continue
          point ??= { lat: hit.lat, lng: hit.lng }
          if (hit.geojson) next.push({ id: item.id, geometry: hit.geojson })
          setAreas([...next])
          if (point) setFocus({ ...point, zoom: item.abroad ? 11 : 14 })
        }
      })()
    }, abroad ? 700 : 250)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [abroad, key])

  return { areas, focus }
}

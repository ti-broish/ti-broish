import { useEffect, useRef, useState } from 'react'
import type { Geometry } from 'geojson'
import { geocodePlace } from './geo'
import type { OutlineRequest } from './model'

export interface MapArea {
  id: string
  geometry: Geometry
}

function usableOutline(query: string, geometry: Geometry | null) {
  if (!geometry || !query.startsWith('район ')) return geometry
  const bounds = LBounds(geometry)
  if (!bounds) return geometry
  const [south, north, west, east] = bounds
  if (north - south > 0.2 || east - west > 0.25) return null
  return geometry
}

function LBounds(geometry: Geometry): [number, number, number, number] | null {
  const points: number[][] = []
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push(value as number[])
      return
    }
    for (const item of value) walk(item)
  }
  if ('coordinates' in geometry) walk(geometry.coordinates)
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
  return [south, north, west, east]
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
          if (cancelled) return
          if (quick) {
            pointCache.set(cacheKey, { lat: quick.lat, lng: quick.lng })
            point ??= { lat: quick.lat, lng: quick.lng }
            setFocus({ ...point, zoom: item.abroad ? 11 : 14 })
          }
          const hit = await geocodePlace({
            data: { query: item.query, abroad: item.abroad, polygon: true, scope: item.scope, priority: 'high' },
          })
          if (cancelled) return
          const geometry = usableOutline(item.query, hit?.geojson ?? null)
          geometryCache.set(cacheKey, geometry)
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

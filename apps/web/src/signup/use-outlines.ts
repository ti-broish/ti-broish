import { useEffect, useRef, useState } from 'react'
import type { Geometry } from 'geojson'
import { geocodePlace } from './geo'
import type { OutlineRequest } from './model'

export interface MapArea {
  id: string
  geometry: Geometry
}

export function useOutlines(queries: OutlineRequest[]) {
  const key = queries.map((item) => `${item.id}:${item.scope}:${item.query}`).join('|')
  const abroad = queries.some((item) => item.abroad)
  const [areas, setAreas] = useState<MapArea[]>([])
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom: number } | null>(null)
  const latest = useRef(queries)
  latest.current = queries

  useEffect(() => {
    const pending = latest.current
    if (pending.length === 0) {
      setAreas([])
      setFocus(null)
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
          if (!hit) continue
          point ??= { lat: hit.lat, lng: hit.lng }
          if (hit.geojson) next.push({ id: item.id, geometry: hit.geojson })
          setAreas([...next])
          if (point) setFocus({ ...point, zoom: item.abroad ? 11 : 13 })
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

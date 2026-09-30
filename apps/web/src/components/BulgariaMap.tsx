import { useEffect, useState, type ComponentType } from 'react'
import type { Geometry } from 'geojson'

export interface MapPoint {
  id: string
  lat: number
  lng: number
  label: string
  detail: string
  sectionIds: string[]
  selected?: boolean
  tone?: 'paper' | 'machine'
}

export interface MapArea {
  id: string
  geometry: Geometry
  selected?: boolean
}

type MapProps = {
  regionCodes: string[]
  focus?: { lat: number; lng: number; zoom: number } | null
  interactive?: boolean
  onToggle?: (regionCode: string) => void
  points?: MapPoint[]
  onPoint?: (id: string) => void
  area?: Geometry | null
  areas?: MapArea[]
  onArea?: (id: string) => void
  quietCity?: boolean
  waitForArea?: boolean
  fitSelected?: boolean
}

export function BulgariaMap(props: MapProps) {
  const [Impl, setImpl] = useState<ComponentType<MapProps> | null>(null)

  useEffect(() => {
    let cancelled = false
    void import('./BulgariaMapClient').then((mod) => {
      if (!cancelled) setImpl(() => mod.BulgariaMapClient)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!Impl) return <div className="h-[420px] bg-[#eee]" aria-hidden />
  return <Impl {...props} />
}

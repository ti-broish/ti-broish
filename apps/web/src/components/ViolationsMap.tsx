import { useEffect, useState, type ComponentType } from 'react'

export interface ViolationsMapProps {
  regions: Record<string, number>
  selected: string | null
  onSelect: (region: string | null) => void
}

// The outlines (~35 KB gzipped) load after the page, so the feed and the „Подай сигнал“ button come first.
export function ViolationsMap(props: ViolationsMapProps) {
  const [Impl, setImpl] = useState<ComponentType<ViolationsMapProps> | null>(null)
  useEffect(() => {
    let cancelled = false
    void import('./ViolationsMapSvg').then((mod) => {
      if (!cancelled) setImpl(() => mod.ViolationsMapSvg)
    })
    return () => {
      cancelled = true
    }
  }, [])
  if (!Impl) return <div className="violations-map violations-map--loading" aria-hidden />
  return <Impl {...props} />
}

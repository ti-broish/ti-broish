import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { regionData, type MapMode, type SectionsMode, type UnitNode, type UnitStats } from '../../home/results'
import { TipCard } from './Tip'

// results: components/bulgaria_map/BulgariaMap.js — the country map on the home page. A click on a region
// opens its page (/<МИР>); the buttons above switch what the colours show.

interface Filters {
  violationsReported: boolean
  sectionsWithResults: boolean
  populatedSections: boolean
}

const PRIMARY_CONTROLS: { title: string; mode: MapMode; showIf: keyof Filters | 'always' }[] = [
  { title: 'Сигнали', mode: 'violations', showIf: 'violationsReported' },
  { title: 'Секции', mode: 'sectionsWithResults', showIf: 'always' },
  { title: 'Избиратели', mode: 'voters', showIf: 'always' },
]

const SECTION_CONTROLS: { title: string; mode: SectionsMode; showIf: keyof Filters | 'always' }[] = [
  { title: 'Обработени', mode: 'processed', showIf: 'sectionsWithResults' },
  { title: 'Рискови', mode: 'risk', showIf: 'always' },
  { title: 'Покритие', mode: 'populated', showIf: 'populatedSections' },
]

type Paths = { viewBox: string; translate: string; paths: Record<string, string> }

export function BulgariaMap({
  regions,
  stats,
  mode,
  setMode,
  sectionsMode,
  setSectionsMode,
}: {
  regions: UnitNode[]
  stats: UnitStats
  mode: MapMode
  setMode: (mode: MapMode) => void
  sectionsMode: SectionsMode
  setSectionsMode: (mode: SectionsMode) => void
}) {
  const navigate = useNavigate()
  const wrapper = useRef<HTMLDivElement>(null)
  const [paths, setPaths] = useState<Paths | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [tipAt, setTipAt] = useState<{ x: number; y: number } | null>(null)

  // The outlines (~35 KB gzipped) load after the page, so the table and the feed come first.
  useEffect(() => {
    let cancelled = false
    void import('../../home/region-paths').then((mod) => {
      if (!cancelled) setPaths({ viewBox: mod.MAP_VIEW_BOX, translate: mod.MAP_TRANSLATE, paths: mod.REGION_PATHS })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filters: Filters = {
    violationsReported: stats.violationsCount > 0,
    sectionsWithResults: stats.sectionsWithResults > 0,
    populatedSections: stats.populated > 0,
  }
  const show = (showIf: keyof Filters | 'always') => showIf === 'always' || filters[showIf]
  const data = regionData(regions, mode, sectionsMode)
  // The DOM order stays put (moving the hovered node under the pointer drops its click);
  // a pointer-transparent copy drawn last lifts the hovered region above its neighbours.
  const keys = paths ? Object.keys(paths.paths) : []
  const hoveredRegion = hovered ? regions.find((region) => String(region.id) === hovered) : null
  const hoveredData = hovered ? data[hovered] : null

  const move = (event: React.MouseEvent) => {
    const box = wrapper.current?.getBoundingClientRect()
    if (box) setTipAt({ x: event.clientX - box.left, y: event.clientY - box.top })
  }
  const open = (key: string) => void navigate({ to: '/$unit', params: { unit: key } })

  return (
    <>
      <div className="rs-controls rs-controls--map" role="group" aria-label="Покажи на картата">
        {PRIMARY_CONTROLS.filter((control) => show(control.showIf)).map((control) => (
          <button
            key={control.mode}
            type="button"
            className={mode === control.mode ? 'selected' : ''}
            aria-pressed={mode === control.mode}
            onClick={() => setMode(control.mode)}
          >
            {control.title}
          </button>
        ))}
      </div>
      {mode === 'sectionsWithResults' ? (
        <div className="rs-controls rs-controls--secondary" role="group" aria-label="Секции">
          {SECTION_CONTROLS.filter((control) => show(control.showIf)).map((control) => (
            <button
              key={control.mode}
              type="button"
              className={sectionsMode === control.mode ? 'selected' : ''}
              aria-pressed={sectionsMode === control.mode}
              onClick={() => setSectionsMode(control.mode)}
            >
              {control.title}
            </button>
          ))}
        </div>
      ) : null}
      <div className="rs-map" ref={wrapper}>
        <svg
          id="bulgaria-map"
          className="rs-map__svg"
          viewBox={paths?.viewBox ?? '0 0 26127.612 16967.859'}
          role="img"
          aria-label="Карта на изборните райони"
        >
          {paths ? (
            <g transform={paths.translate}>
              {keys.map((key) => {
                const region = regions.find((item) => String(item.id) === key)
                const color = data[key]?.color ?? '#eee'
                return (
                  <path
                    key={key}
                    id={`rs-region-${key}`}
                    d={paths.paths[key]}
                    role="link"
                    tabIndex={0}
                    aria-label={region?.name ?? key}
                    data-region={key}
                    style={{
                      fill: color,
                      transition: 'fill 1.5s ease, transform 0.3s ease, filter 0.3s ease',
                      ...(key === '32' ? { pointerEvents: 'bounding-box' as React.CSSProperties['pointerEvents'] } : {}),
                    }}
                    onClick={() => open(key)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        open(key)
                      }
                    }}
                    onMouseEnter={(event) => {
                      setHovered(key)
                      move(event)
                    }}
                    onMouseMove={move}
                    onMouseLeave={() => {
                      setHovered(null)
                      setTipAt(null)
                    }}
                    onFocus={() => setHovered(key)}
                    onBlur={() => setHovered(null)}
                  />
                )
              })}
              {hovered && paths.paths[hovered] ? (
                <use
                  href={`#rs-region-${hovered}`}
                  className="rs-map__lifted"
                  aria-hidden="true"
                  style={{ fill: data[hovered]?.color ?? '#eee' }}
                />
              ) : null}
            </g>
          ) : null}
        </svg>
        {hoveredRegion && tipAt ? (
          <div className="rs-map__tip" role="tooltip" style={{ left: tipAt.x, top: tipAt.y }}>
            <TipCard
              title={hoveredRegion.name}
              rows={hoveredData?.rows ?? []}
              empty={hoveredData ? undefined : 'Няма данни (все още)'}
            />
          </div>
        ) : null}
      </div>
      {mode === 'sectionsWithResults' && sectionsMode === 'risk' ? <p>* Данни за рискови секции от ОЧИ</p> : null}
    </>
  )
}

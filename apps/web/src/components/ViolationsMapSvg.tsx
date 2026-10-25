import { useLayoutEffect, useRef, useState } from 'react'
import { MAP_TRANSLATE, MAP_VIEW_BOX, REGION_PATHS } from '../home/region-paths'
import { regionName } from '../home/regions'
import { heatLevel } from '../home/violations'
import type { ViolationsMapProps } from './ViolationsMap'

// The old results site's map (ti-broish/results, bulgaria_map): one SVG path per МИР, coloured by count.
// A count badge sits in the middle of each region with signals.
const CODES = Object.keys(REGION_PATHS)
// София-град is three small МИР side by side, so their badges are smaller to stay apart.
const SMALL = new Set(['23', '24', '25'])

type Centre = { x: number; y: number }

export function ViolationsMapSvg({ regions, selected, onSelect }: ViolationsMapProps) {
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({})
  const [centres, setCentres] = useState<Record<string, Centre>>({})
  const max = Math.max(0, ...Object.values(regions))

  useLayoutEffect(() => {
    const next: Record<string, Centre> = {}
    for (const code of CODES) {
      const box = pathRefs.current[code]?.getBBox()
      if (box) next[code] = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    setCentres(next)
  }, [])

  // The selected region is drawn last so its outline is on top.
  const order = selected ? [...CODES.filter((code) => code !== selected), selected] : CODES

  return (
    <svg className="violations-map" viewBox={MAP_VIEW_BOX} role="group" aria-label="Карта на сигналите по изборни райони">
      <g transform={MAP_TRANSLATE}>
        {order.map((code) => {
          const count = regions[code] ?? 0
          const label = `${regionName(code)}: ${count === 0 ? 'няма сигнали' : `${count} ${count === 1 ? 'сигнал' : 'сигнала'}`}`
          return (
            <path
              key={code}
              ref={(node) => {
                pathRefs.current[code] = node
              }}
              d={REGION_PATHS[code]}
              className={`vm-region vm-heat-${heatLevel(count, max)}${selected === code ? ' is-selected' : ''}${code === '32' ? ' vm-abroad' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={selected === code}
              onClick={() => onSelect(selected === code ? null : code)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(selected === code ? null : code)
                }
              }}
            >
              <title>{label}</title>
            </path>
          )
        })}
        {CODES.map((code) => {
          const count = regions[code] ?? 0
          const centre = centres[code]
          if (!count || !centre) return null
          const text = count > 999 ? '999+' : String(count)
          return (
            <g key={code} className={SMALL.has(code) ? 'vm-badge vm-badge--small' : 'vm-badge'} transform={`translate(${centre.x},${centre.y})`} aria-hidden>
              <circle r={(text.length > 2 ? 720 : 560) * (SMALL.has(code) ? 0.62 : 1)} />
              <text dy="0.35em">{text}</text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

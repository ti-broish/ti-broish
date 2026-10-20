import { useEffect, useState } from 'react'
import { BulgariaMap, type MapPoint } from './BulgariaMap'
import { geocodePlace } from '../signup/geo'
import { highlightCodes, placeOutline, type HomePlace } from '../signup/model'
import { sectionNumber } from '../signup/sections'
import { useOutlines } from '../signup/use-outlines'
import { assignedSectionLine, assignedSectionQuery, type AssignedSectionPlace } from '../signup/assigned-section-place'

/**
 * Map of the assigned section. The pin comes from the section's own address and settlement
 * (looked up by its code); the place the person picked at signup is never used for the pin.
 */
export function AssignedSectionMap({
  place,
  section,
  assigned,
}: {
  place: HomePlace | null
  section: string
  assigned: AssignedSectionPlace | null
}) {
  const outlines = useOutlines(placeOutline(place))
  const [point, setPoint] = useState<MapPoint | null>(null)
  const own = assigned && assigned.section === section ? assigned : null
  const query = assignedSectionQuery(own)
  const abroad = section.startsWith('32')
  const address = assignedSectionLine(own)

  useEffect(() => {
    if (!query) {
      setPoint(null)
      return
    }
    let cancelled = false
    void geocodePlace({ data: { query, abroad, priority: 'high' } }).then((hit) => {
      if (cancelled) return
      if (!hit || hit.category === 'boundary' || hit.type === 'administrative') {
        setPoint(null)
        return
      }
      setPoint({
        id: 'assigned-section',
        lat: hit.lat,
        lng: hit.lng,
        label: `Секция ${sectionNumber(section)}`,
        detail: address || section,
        sectionIds: [section],
        selected: true,
        tone: 'paper',
      })
    })
    return () => {
      cancelled = true
    }
  }, [address, abroad, query, section])

  return (
    <div className="grid gap-2">
      <BulgariaMap
        regionCodes={highlightCodes(place, null, [])}
        focus={point ? { lat: point.lat, lng: point.lng, zoom: abroad ? 12 : 15 } : outlines.focus}
        areas={outlines.areas}
        quietCity={Boolean(place?.cityRegionName) && !abroad}
        waitForArea={!point && Boolean(place?.cityRegionName)}
        points={point ? [point] : []}
      />
      <p className="text-sm leading-6 text-[var(--ink-soft)]">
        {address
          ? `Карта на секция ${sectionNumber(section)} · ${address}`
          : `Карта на назначената секция ${sectionNumber(section)}.`}
      </p>
    </div>
  )
}

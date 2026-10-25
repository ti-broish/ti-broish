// The old API has no field for the address or the city district of a signal, only town and section.
// The signal form puts them on the first line of the description so the lawyers see where it happened.
import type { HomePlace } from './model'

/** "Адрес: …, район …", "Адрес: …" or "Район: …"; empty without either. */
export function placeLine(place: Pick<HomePlace, 'sectionPlace' | 'cityRegionName'> | null | undefined): string {
  const address = place?.sectionPlace?.trim()
  const district = place?.cityRegionName?.trim()
  if (address && district) return `Адрес: ${address}, район ${district}`
  if (address) return `Адрес: ${address}`
  if (district) return `Район: ${district}`
  return ''
}

/** The description the API stores: the place line, a blank line, then what the person wrote. */
export function describedSignal(place: Pick<HomePlace, 'sectionPlace' | 'cityRegionName'> | null | undefined, description: string): string {
  const line = placeLine(place)
  return line ? `${line}\n\n${description}` : description
}

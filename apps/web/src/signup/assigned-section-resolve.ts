import { normalizeSection } from './admin-csv'
import { assignedPlaceFromSpot, type AssignedSectionPlace } from './assigned-section-place'
import { lookupSectionPlaces } from './section-places-lookup'
import type { SectionSpot } from './section-where'

export type SectionLookup = (codes: string[], townIdsByCode: Record<string, number[]>) => Promise<Record<string, SectionSpot>>

/**
 * Address and settlement of an assigned section by its exact code. The person's town is only a hint
 * for where to start searching. Null when the lookup fails or does not know the section.
 */
export async function resolveAssignedSectionPlace(
  section: string,
  townIds: number[] = [],
  lookup: SectionLookup = lookupSectionPlaces,
): Promise<AssignedSectionPlace | null> {
  const code = normalizeSection(String(section ?? ''))
  if (!/^\d{9}$/.test(code)) return null
  try {
    const hints = townIds.filter((id) => Number.isInteger(id) && id > 0)
    const places = await lookup([code], hints.length > 0 ? { [code]: hints } : {})
    return assignedPlaceFromSpot(code, places[code])
  } catch {
    return null
  }
}

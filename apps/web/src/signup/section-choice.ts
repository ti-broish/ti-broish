// The signal form picks a section in two steps: the address, then "Номер на секция" when the address has
// several sections. The signup form picks only an address (a preference), so it never sets a section here.
import type { HomePlace } from './model'
import { sectionNumber } from './sections'

export interface AddressGroup {
  place: string
  sections: { id: string }[]
  paper: number
  machine: number
}

/** The place after picking an address (or none). With `pickSection`, an address with one section also sets it. */
export function placeWithAddress(value: HomePlace, group: AddressGroup | undefined, pickSection: boolean): HomePlace {
  const only = pickSection && group?.sections.length === 1 ? group.sections[0]?.id : undefined
  return {
    ...value,
    sectionId: only,
    sectionPlace: group?.place,
    paperCount: group ? group.paper : null,
    machineCount: group ? group.machine : null,
  }
}

/** The "Номер на секция" options for an address, by number; empty unless the address has several sections. */
export function sectionChoices(group: AddressGroup | undefined): { id: string; label: string }[] {
  if (!group || group.sections.length < 2) return []
  return [...group.sections]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((section) => ({ id: section.id, label: `${sectionNumber(section.id)} (${section.id})` }))
}

/** The place after picking a section number; only a section at the chosen address counts. */
export function placeWithSection(value: HomePlace, group: AddressGroup | undefined, sectionId: string): HomePlace {
  const section = group?.sections.find((item) => item.id === sectionId)
  return { ...value, sectionId: section?.id }
}

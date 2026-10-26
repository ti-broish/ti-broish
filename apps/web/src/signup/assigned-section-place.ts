/**
 * Where an assigned (published) section is: its own address and settlement, looked up by the
 * exact section code (the API, GET /sections/abroad for abroad sections), the same way the Brevo sync does.
 * Never the place the person picked when signing up: that is only their preference.
 */
export type AssignedSectionPlace = {
  section: string
  address: string
  /** Settlement, e.g. „с. Елешница“; abroad „Лондон (Фелтъм), Обединено кралство“. */
  settlement: string
}

type Spot = { address?: string; area?: string; town?: string }

/** Address and settlement of one section from a lookup result; null when the lookup knows neither. */
export function assignedPlaceFromSpot(section: string, spot: Spot | null | undefined): AssignedSectionPlace | null {
  if (!spot) return null
  const code = section.replace(/\D/g, '')
  const address = (spot.address ?? '').trim()
  const town = (spot.town ?? '').trim()
  const abroad = /^32\d{7}$/.test(code)
  const country = abroad ? (spot.area ?? '').trim() : ''
  // The area alone („Ловеч, община Ловеч“) is not a settlement, so it is never shown as one.
  const settlement = abroad ? [town, country].filter(Boolean).join(', ') : town
  if (!address && !town) return null
  return { section: code, address, settlement }
}

function plainTown(name: string) {
  return name.replace(/^(гр|с|к|ман)\.\s*/iu, '').trim().toLowerCase()
}

/** „адрес, населено място“ for mail and maps; the settlement is skipped when the address already names it. */
export function assignedSectionLine(place: AssignedSectionPlace | null | undefined) {
  if (!place) return ''
  const town = plainTown(place.settlement.split(',')[0] ?? '')
  if (!place.address) return place.settlement
  if (!place.settlement || (town && place.address.toLowerCase().includes(town))) return place.address
  return `${place.address}, ${place.settlement}`
}

/** Text for a map search: address, settlement and the country (България at home). */
export function assignedSectionQuery(place: AssignedSectionPlace | null | undefined) {
  if (!place) return null
  const line = assignedSectionLine(place)
  if (!line) return null
  return /^32\d{7}$/.test(place.section) ? line : `${line}, България`
}

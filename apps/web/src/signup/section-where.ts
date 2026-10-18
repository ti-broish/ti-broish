import { regionNameOf, staffTravelText } from './admin-progress'
import type { HomePlace, NamedPlace, Radius, TravelStop } from './model'

const RADII = new Set<Radius>(['cityRegion', 'nearby', 'settlement', 'municipality', 'region', 'distant'])

export interface SignupSpot {
  oblast: string
  municipality: string
  town: string
  district: string
  address: string
  reach: string
}

export interface SignupSpotInput {
  region: string
  regionName?: string
  municipality?: string
  town?: string
  cityRegion?: string
  place?: string
  countryName?: string
  radius?: string
  extraCityRegions?: NamedPlace[]
  distantRegionCodes?: string[]
  travelMunicipalities?: TravelStop[]
}

/** Where the person signed up, in Bulgarian. The radius id never appears. */
export function signupSpot(person: SignupSpotInput): SignupSpot {
  const abroad = person.region === '32'
  const oblast = abroad
    ? person.countryName?.trim() || person.regionName?.trim() || 'Чужбина'
    : person.regionName?.trim() || regionNameOf(person.region)
  return {
    oblast,
    municipality: abroad ? '' : person.municipality?.trim() ?? '',
    town: person.town?.trim() ?? '',
    district: abroad ? '' : person.cityRegion?.trim() ?? '',
    address: person.place?.trim() ?? '',
    reach: reachOf(person, oblast),
  }
}

function reachOf(person: SignupSpotInput, oblast: string) {
  const radius = asRadius(person.radius)
  if (!radius) return ''
  const place: HomePlace = {
    regionCode: person.region === '32' ? '32' : person.region || '',
    regionName: person.regionName?.trim() || oblast,
    municipalityName: person.municipality?.trim() || undefined,
    townName: person.town?.trim() || undefined,
    cityRegionName: person.cityRegion?.trim() || undefined,
    countryName: person.countryName?.trim() || undefined,
  }
  const text = staffTravelText({
    place,
    radius,
    extraCityRegions: person.extraCityRegions ?? [],
    distantRegionCodes: person.distantRegionCodes ?? [],
    travelMunicipalities: person.travelMunicipalities ?? [],
  })
  return text === 'Без обхват' ? '' : text
}

function asRadius(value: string | undefined): Radius | null {
  if (!value || !RADII.has(value as Radius)) return null
  return value as Radius
}

export interface SectionParts {
  mir: string
  municipality: string
  district: string
  number: string
}

/** Nine-digit section id: МИР + община + район + номер. */
export function splitSection(code: string): SectionParts | null {
  const digits = code.replace(/\D/g, '')
  if (digits.length !== 9) return null
  return {
    mir: digits.slice(0, 2),
    municipality: digits.slice(2, 4),
    district: digits.slice(4, 6),
    number: digits.slice(6),
  }
}

export interface SectionDirectory {
  regions: Record<string, string>
  municipalities: Record<string, string>
  districts: Record<string, string>
  addresses: Record<string, string>
  /** Settlement name per 9-digit section id (e.g. "гр.София"). */
  towns: Record<string, string>
}

export const EMPTY_SECTION_DIRECTORY: SectionDirectory = {
  regions: {},
  municipalities: {},
  districts: {},
  addresses: {},
  towns: {},
}

export interface SectionSpot {
  address: string
  area: string
  /** Settlement of the section when the directory knows it (e.g. "гр.София"). */
  town?: string
}

/** Where a section id sits: the address when we have it, and oblast / община / район. */
export function sectionSpot(code: string, directory: SectionDirectory): SectionSpot {
  const parts = splitSection(code)
  if (!parts) return { address: '', area: '' }
  const id = `${parts.mir}${parts.municipality}${parts.district}${parts.number}`
  const region = directory.regions[parts.mir] || regionNameOf(parts.mir)
  const municipality = directory.municipalities[`${parts.mir}:${parts.municipality}`] ?? ''
  const districtName = parts.district === '00' ? '' : directory.districts[`${parts.mir}:${parts.municipality}:${parts.district}`] ?? ''
  const area = [region, municipality ? `община ${municipality}` : '', districtName ? `район ${districtName}` : ''].filter(Boolean).join(', ')
  const town = directory.towns[id]?.trim() ?? ''
  return town ? { address: directory.addresses[id] ?? '', area, town } : { address: directory.addresses[id] ?? '', area }
}

/** Settlement when known, otherwise the geographic area text. */
export function sectionPlaceOf(spot: Pick<SectionSpot, 'town' | 'area'>) {
  const town = spot.town?.trim() ?? ''
  return town || spot.area
}

export interface RegionSource {
  code: string
  name: string
  municipalities?: Array<{ code: string; name: string }>
}

export interface TownSource {
  mir: string
  municipality: string
  cityRegions: Array<{ code: string; name: string }>
}

export function assembleDirectory(input: {
  regions: RegionSource[]
  towns: TownSource[]
  sections: Array<{ id: string; place: string; town?: string }>
}): SectionDirectory {
  const regions: Record<string, string> = {}
  const municipalities: Record<string, string> = {}
  for (const region of input.regions) {
    const code = pad2(region.code)
    if (!code) continue
    const label = regionLabel(code, region.name)
    if (label) regions[code] = label
    for (const municipality of region.municipalities ?? []) {
      const muni = pad2(municipality.code)
      const name = municipality.name.trim()
      if (!muni || !name) continue
      municipalities[`${code}:${muni}`] = name
    }
  }
  const districts: Record<string, string> = {}
  for (const town of input.towns) {
    const mir = pad2(town.mir)
    const muni = pad2(town.municipality)
    if (!mir || !muni) continue
    for (const district of town.cityRegions) {
      const code = pad2(district.code)
      const name = district.name.trim()
      if (!code || code === '00' || !name) continue
      districts[`${mir}:${muni}:${code}`] = name
    }
  }
  const addresses: Record<string, string> = {}
  const towns: Record<string, string> = {}
  for (const section of input.sections) {
    const parts = splitSection(section.id)
    const place = section.place.trim()
    if (!parts || !place) continue
    const id = `${parts.mir}${parts.municipality}${parts.district}${parts.number}`
    addresses[id] = place
    const settlement = section.town?.trim() ?? ''
    if (settlement) towns[id] = settlement
  }
  return { regions, municipalities, districts, addresses, towns }
}

function regionLabel(code: string, apiName: string) {
  if (code === '23' || code === '24' || code === '25') return 'София-град'
  const name = apiName.trim()
  return name || regionNameOf(code)
}

export interface TownRef {
  mir: string
  municipality: string
  id: number
  cityRegions: Array<{ code: string; name: string }>
}

/** Towns whose section list can name an address. Ambiguous municipalities stay geographic only. */
export function addressTownIds(codes: string[], knownTownIds: number[], towns: TownRef[], found: ReadonlySet<string>) {
  const ordered: number[] = []
  const seen = new Set<number>()
  function add(id: number) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) return
    seen.add(id)
    ordered.push(id)
  }
  for (const id of knownTownIds) add(id)
  const byPair = new Map<string, TownRef[]>()
  for (const town of towns) {
    const key = `${pad2(town.mir)}:${pad2(town.municipality)}`
    const list = byPair.get(key) ?? []
    list.push(town)
    byPair.set(key, list)
  }
  for (const code of codes) {
    const parts = splitSection(code)
    if (!parts) continue
    const id = `${parts.mir}${parts.municipality}${parts.district}${parts.number}`
    if (found.has(id)) continue
    const list = byPair.get(`${parts.mir}:${parts.municipality}`) ?? []
    const matches = parts.district === '00' ? list : list.filter((town) => town.cityRegions.some((region) => pad2(region.code) === parts.district))
    if (matches.length === 1) add(matches[0].id)
  }
  return ordered.slice(0, 40)
}

export function readSectionPlaces(payload: unknown) {
  if (!Array.isArray(payload)) return [] as Array<{ id: string; place: string; town?: string }>
  const rows: Array<{ id: string; place: string; town?: string }> = []
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue
    const id = String((item as { id?: unknown }).id ?? '')
    const place = (item as { place?: unknown }).place
    if (typeof place !== 'string' || !place.trim() || !splitSection(id)) continue
    const townRaw = (item as { town?: unknown }).town
    const townName =
      townRaw && typeof townRaw === 'object' && typeof (townRaw as { name?: unknown }).name === 'string'
        ? (townRaw as { name: string }).name.trim()
        : ''
    rows.push(townName ? { id, place: place.trim(), town: townName } : { id, place: place.trim() })
  }
  return rows
}

export function readTownRefs(mir: string, municipality: string, payload: unknown): TownRef[] {
  if (!Array.isArray(payload)) return []
  const refs: TownRef[] = []
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue
    const regions = (item as { cityRegions?: unknown }).cityRegions
    const cityRegions = Array.isArray(regions)
      ? regions.flatMap((region) => {
          if (!region || typeof region !== 'object') return []
          const code = pad2(String((region as { code?: unknown }).code ?? ''))
          const name = String((region as { name?: unknown }).name ?? '').trim()
          return code && name ? [{ code, name }] : []
        })
      : []
    refs.push({ mir, municipality, id, cityRegions })
  }
  return refs
}

function pad2(value: string) {
  const trimmed = value.trim()
  if (!/^\d{1,2}$/.test(trimmed)) return ''
  return trimmed.padStart(2, '0')
}

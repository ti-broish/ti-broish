import { normalizeSection } from './admin-csv'
import { mfaAbroadSection } from './abroad-section-addresses'
import {
  addressTownIds,
  assembleDirectory,
  EMPTY_SECTION_DIRECTORY,
  readSectionPlaces,
  readTownRefs,
  sectionSpot,
  splitSection,
  type RegionSource,
  type SectionSpot,
  type TownRef,
} from './section-where'

const API = 'https://api.tibroish.bg'
const HEADERS = { Accept: 'application/json', 'Accept-Language': 'bg-BG' }
const MAX_PAIRS_PER_BATCH = 40
const MAX_TOWN_IDS_PER_BATCH = 40
/** Extra town lookups per batch when searching a multi-town municipality (keeps a sync well under the subrequest limit). */
const MAX_SEARCH_TOWNS_PER_BATCH = 900
const SEARCH_ROUND = 6

let regionCache: RegionSource[] | null = null
const townCache = new Map<string, TownRef[]>()
const sectionCache = new Map<number, Array<{ id: string; place: string; town?: string }>>()

export type SectionLookupBatch = { codes: string[]; townIds: number[] }

/**
 * Pack section codes into directory lookups that stay within the API helper caps:
 * at most 40 distinct mir:municipality pairs and 40 town ids per batch.
 */
export function sectionLookupBatches(codes: string[], townIdsByCode: Record<string, number[]> = {}): SectionLookupBatch[] {
  const unique = [...new Set(codes.map((code) => normalizeSection(String(code))).filter((code) => /^\d{9}$/.test(code)))]
  const byPair = new Map<string, string[]>()
  for (const code of unique) {
    const parts = splitSection(code)
    if (!parts) continue
    const pair = `${parts.mir}:${parts.municipality}`
    const list = byPair.get(pair) ?? []
    list.push(code)
    byPair.set(pair, list)
  }

  const batches: SectionLookupBatch[] = []
  let batchCodes: string[] = []
  let batchPairs = 0
  const flush = () => {
    if (batchCodes.length === 0) return
    const townIds: number[] = []
    const seen = new Set<number>()
    for (const code of batchCodes) {
      for (const id of townIdsByCode[code] ?? []) {
        if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue
        seen.add(id)
        townIds.push(id)
        if (townIds.length >= MAX_TOWN_IDS_PER_BATCH) break
      }
      if (townIds.length >= MAX_TOWN_IDS_PER_BATCH) break
    }
    batches.push({ codes: batchCodes, townIds })
    batchCodes = []
    batchPairs = 0
  }

  for (const group of byPair.values()) {
    if (batchPairs > 0 && batchPairs + 1 > MAX_PAIRS_PER_BATCH) flush()
    batchCodes.push(...group)
    batchPairs += 1
  }
  flush()
  return batches
}

/** Resolve section codes to address/area/town via api.tibroish.bg. Pair-aware batches; blanks on failure. */
export async function lookupSectionPlaces(
  codes: string[],
  townIdsByCode: Record<string, number[]> = {},
): Promise<Record<string, SectionSpot>> {
  const places: Record<string, SectionSpot> = {}
  // Abroad sections: the API has no address, the MFA table does.
  const domestic: string[] = []
  for (const raw of codes) {
    const code = normalizeSection(String(raw))
    const mfa = mfaAbroadSection(code)
    if (mfa) places[code] = { address: mfa.address, area: mfa.country, town: mfa.place }
    else domestic.push(raw)
  }
  for (const batch of sectionLookupBatches(domestic, townIdsByCode)) {
    try {
      const directory = await directoryFor(batch.codes, batch.townIds)
      for (const code of batch.codes) places[code] = sectionSpot(code, directory)
    } catch {
      for (const code of batch.codes) {
        if (!places[code]) places[code] = sectionSpot(code, EMPTY_SECTION_DIRECTORY)
      }
    }
  }
  return places
}

async function directoryFor(codes: string[], townIds: number[]) {
  const regions = await loadRegions()
  const pairs = [
    ...new Set(
      codes.flatMap((code) => {
        const mir = code.slice(0, 2)
        const municipality = code.slice(2, 4)
        return mir && municipality ? [`${mir}:${municipality}`] : []
      }),
    ),
  ].slice(0, MAX_PAIRS_PER_BATCH)
  const townRefs = (await pool(pairs, 6, loadTowns)).flat()
  const firstWave = townIds.slice(0, MAX_TOWN_IDS_PER_BATCH)
  const first = await pool(firstWave, 6, loadSections)
  const found = new Set(first.flat().map((section) => section.id.replace(/\D/g, '')))
  const extra = addressTownIds(codes, [], townRefs, found).filter((id) => !firstWave.includes(id))
  const second = await pool(extra, 6, loadSections)
  for (const section of second.flat()) found.add(section.id.replace(/\D/g, ''))
  // Sections in a municipality with several towns: the signup's town is often not the section's,
  // so search every candidate town of that municipality (and city district) until found.
  const tried = new Set([...firstWave, ...extra])
  const third: Array<{ id: string; place: string; town?: string }> = []
  let budget = MAX_SEARCH_TOWNS_PER_BATCH
  for (const code of codes) {
    if (budget <= 0) break
    // One code at a time, a few towns per round, stopping as soon as the section turns up.
    while (budget > 0) {
      const next = searchTownIds([code], townRefs, found, tried, Math.min(SEARCH_ROUND, budget))
      if (next.length === 0) break
      for (const id of next) tried.add(id)
      budget -= next.length
      const rows = (await pool(next, SEARCH_ROUND, loadSections)).flat()
      third.push(...rows)
      for (const row of rows) found.add(row.id.replace(/\D/g, ''))
    }
  }
  return assembleDirectory({ regions, towns: townRefs, sections: [...first.flat(), ...second.flat(), ...third] })
}

/** Towns to search for sections still without an address, capped per batch. */
export function searchTownIds(codes: string[], towns: TownRef[], found: ReadonlySet<string>, tried: ReadonlySet<number>, cap = MAX_SEARCH_TOWNS_PER_BATCH) {
  const out: number[] = []
  const seen = new Set<number>()
  for (const code of codes) {
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 9 || found.has(digits) || digits.startsWith('32')) continue
    const mir = digits.slice(0, 2)
    const municipality = digits.slice(2, 4)
    const district = digits.slice(4, 6)
    const inPair = towns.filter((town) => town.mir === mir && town.municipality === municipality)
    const inDistrict = district === '00' ? [] : inPair.filter((town) => town.cityRegions.some((region) => region.code === district))
    // District towns first; a village of that district may carry no city region, so then the rest.
    for (const town of [...inDistrict, ...inPair.filter((item) => !inDistrict.includes(item))]) {
      if (tried.has(town.id) || seen.has(town.id)) continue
      seen.add(town.id)
      out.push(town.id)
      if (out.length >= cap) return out
    }
  }
  return out
}

async function loadRegions() {
  if (regionCache) return regionCache
  const payload = await getJson<RegionSource[]>('election_regions')
  if (!payload) return []
  regionCache = payload
  return payload
}

async function loadTowns(pair: string) {
  const cached = townCache.get(pair)
  if (cached) return cached
  const [mir, municipality] = pair.split(':')
  const payload = await getJson<unknown>(`towns?country=000&election_region=${mir}&municipality=${municipality}`)
  const refs = readTownRefs(mir ?? '', municipality ?? '', payload)
  if (payload) townCache.set(pair, refs)
  return refs
}

async function loadSections(townId: number) {
  const cached = sectionCache.get(townId)
  if (cached) return cached
  const payload = await getJson<unknown>(`sections?town=${townId}`)
  const places = readSectionPlaces(payload)
  if (payload) sectionCache.set(townId, places)
  return places
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(12_000) })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index] as T)
    }
  }
  if (items.length === 0) return results
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

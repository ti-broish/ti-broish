// Published signals from the old Ти Броиш API (api.tibroish.bg), shaped for the home page.
// GET /violations/feed?after=<ulid>  newest first, 50 per page
// GET /violations/feed/<segment>     a section-code prefix (RR, RRMM, RRMMDD, 9 digits, 32, 32CCC), up to ~40, no paging
// The items carry no coordinates, so the map counts them per election region (МИР) and municipality.

export const FEED_PAGE_SIZE = 50

/** What the API returns for one published signal (only the fields we read). */
export interface ApiViolation {
  id: string
  type?: string
  status?: string
  publishedText?: string | null
  createdAt?: string
  town?: {
    code?: number | string
    name?: string
    country?: { code?: string; name?: string; isAbroad?: boolean } | null
    municipality?: {
      code?: string
      name?: string
      electionRegions?: { code?: string; name?: string; isAbroad?: boolean }[]
    } | null
    cityRegions?: { code?: string; name?: string }[]
  } | null
  section?: { id?: string; code?: string; place?: string | null } | null
}

/** The public shape sent to the browser: only what the card and the map need. */
export interface FeedItem {
  id: string
  video: boolean
  text: string
  createdAt: string
  town: string
  municipality: string | null
  country: string | null
  /** Election region code '01'–'32', or null when the town spans several (София без секция). */
  region: string | null
  /** Region + municipality code (4 digits), or null when unknown. */
  municipalityKey: string | null
  section: string | null
  demo?: boolean
}

export interface Counts {
  total: number
  regions: Record<string, number>
  municipalities: Record<string, { count: number; name: string }>
  /** Signals whose region is not known (a town in several МИР and no section). */
  unplaced: number
}

const SEGMENT = /^(?:(?:0[1-9]|[12][0-9]|3[01])(?:\d{2}(?:\d{2}(?:\d{3})?)?)?|32(?:\d{3})?)$/
const ULID = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/

export function validSegment(value: unknown): value is string {
  return typeof value === 'string' && SEGMENT.test(value)
}

export function validAfter(value: unknown): value is string {
  return typeof value === 'string' && ULID.test(value)
}

const TWO = /^\d{2}$/
const SECTION_ID = /^\d{9}$/

export function regionOf(item: ApiViolation): string | null {
  const sectionId = item.section?.id
  if (sectionId && SECTION_ID.test(sectionId)) return sectionId.slice(0, 2)
  if (item.town?.country?.isAbroad) return '32'
  const regions = (item.town?.municipality?.electionRegions ?? []).filter((r) => r.code && TWO.test(r.code))
  return regions.length === 1 ? regions[0].code! : null
}

export function municipalityKeyOf(item: ApiViolation, region = regionOf(item)): string | null {
  const sectionId = item.section?.id
  if (sectionId && SECTION_ID.test(sectionId)) return sectionId.slice(0, 4)
  const code = item.town?.municipality?.code
  if (region && region !== '32' && code && TWO.test(code)) return region + code
  return null
}

export function toFeedItem(item: ApiViolation): FeedItem {
  const region = regionOf(item)
  const abroad = Boolean(item.town?.country?.isAbroad)
  const sectionId = item.section?.id
  return {
    id: item.id,
    video: item.type === 'video',
    text: (item.publishedText ?? '').trim(),
    createdAt: item.createdAt ?? '',
    town: item.town?.name ?? '',
    municipality: abroad ? null : (item.town?.municipality?.name ?? null),
    country: abroad ? (item.town?.country?.name ?? null) : null,
    region,
    municipalityKey: municipalityKeyOf(item, region),
    section: sectionId && SECTION_ID.test(sectionId) ? sectionId : null,
  }
}

export function countItems(items: FeedItem[]): Counts {
  const counts: Counts = { total: 0, regions: {}, municipalities: {}, unplaced: 0 }
  for (const item of items) {
    counts.total += 1
    if (!item.region) {
      counts.unplaced += 1
      continue
    }
    counts.regions[item.region] = (counts.regions[item.region] ?? 0) + 1
    if (item.municipalityKey) {
      const entry = (counts.municipalities[item.municipalityKey] ??= { count: 0, name: item.municipality ?? item.town })
      entry.count += 1
    }
  }
  return counts
}

/** Keeps only signals in the segment (a section-code prefix), for filtering what is already loaded. */
export function inSegment(item: FeedItem, segment: string) {
  if (segment.length <= 2) return item.region === segment
  if (item.section) return item.section.startsWith(segment)
  if (segment.length === 4) return item.municipalityKey === segment
  return false
}

/** 0 for none, then 1–5 by share of the busiest region. */
export function heatLevel(count: number, max: number) {
  if (count <= 0 || max <= 0) return 0
  return Math.max(1, Math.min(5, Math.ceil((count / max) * 5)))
}

export function isProductionHost(hostname: string) {
  const host = hostname.toLowerCase()
  return host === 'tibroish.bg' || host === 'www.tibroish.bg'
}

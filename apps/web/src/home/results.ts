// The old results site's units (https://github.com/ti-broish/results, src/components/units and bulgaria_map),
// ported for the home page map, the unit pages (/<МИР>, /<община>, /<район>, /<секция>) and the feed.
// Data: GET <api>/results/<unit>.json (index.json for the country, meta.json for the election), served
// through the worker (src/home/results.server.ts) like /api/violations.

export interface UnitStats {
  voters: number
  sectionsWithResults: number
  validVotes: number
  invalidVotes: number
  violationsCount: number
  sectionsCount: number
  processedViolations: number
  publishedViolations: number
  streamsCount: number
  streamsCountActive?: number
  highRisk: number
  midRisk: number
  population?: number
  populated: number
  sectionsWithProtocols?: number
  violationsCountTown?: number
}

export interface Crumb {
  segment: string
  name: string
  type: string
}

export interface UnitNode {
  id: string | number | null
  segment: string | null
  name: string
  type: string
  results?: number[]
  stats?: UnitStats
  nodes?: UnitNode[]
  number?: string | number
}

export interface ResultsUnit extends UnitNode {
  segment: string
  results: number[]
  stats: UnitStats
  crumbs: Crumb[]
  abroad?: boolean
  nodesType?: string
  nodes?: UnitNode[]
  // Sections only
  riskLevel?: string
  place?: string
  town?: { id: number | string; name: string }
  protocols?: { id: string; pictures?: { url: string }[] }[]
}

export interface ElectionMeta {
  name: string
  endOfElectionDayTimestamp?: string
  parties?: { id: number; name: string; displayName: string; color: string | null }[]
}

/** A published signal as GET /violations/<id> gives it without a secret (only what the page shows). */
export interface PublicViolation {
  id: string
  statusLocalized?: string | null
  publishedText?: string | null
  createdAt?: string | null
  section?: { id: string; electionRegion?: { code: string; name: string } | null } | null
  town?: {
    name: string
    country?: { name: string } | null
    municipality?: { name: string; electionRegions?: { code: string; name: string }[] } | null
  } | null
  pictures?: { url: string }[]
}

// Election regions are two digits (01), municipalities four (0140), countries abroad five (32001),
// city districts six (244601), sections nine (014000037). `index` is the whole country, `meta` the election.
const UNIT = /^(?:index|meta|\d{2}|\d{4}|\d{5}|\d{6}|\d{9})$/

export function validUnit(value: unknown): value is string {
  return typeof value === 'string' && UNIT.test(value)
}

/** A unit page path segment: everything validUnit takes except index/meta. */
export function validUnitPath(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value) && validUnit(value)
}

export function isSection(unit: string) {
  return unit.length === 9
}

export const mapNodeType = (nodesType: string | undefined) => {
  switch (nodesType) {
    case 'election':
      return ''
    case 'electionRegion':
      return 'Избирателен район'
    case 'municipality':
      return 'Община'
    case 'town':
      return 'Нас. място'
    case 'address':
      return 'Адрес'
    case 'section':
      return 'Секция'
    case 'district':
      return 'Район'
    case 'country':
      return 'Държава'
    default:
      return 'Подразделение'
  }
}

export const mapNodesType = (nodesType: string | undefined) => {
  switch (nodesType) {
    case 'electionRegions':
      return 'Избирателни райони'
    case 'municipalities':
      return 'Общини'
    case 'towns':
      return 'Населени места'
    case 'addresses':
      return 'Адреси'
    case 'sections':
      return 'Секции'
    case 'districts':
      return 'Райони'
    case 'countries':
      return 'Държави'
    default:
      return 'Подразделения'
  }
}

/**
 * The election's own name, from the API (e.g. „Президентски избори 25.10.2026“), shown site-wide
 * with the year only: „Президентски избори 2026“, since the same pages now cover the runoff too.
 */
export function electionLabel(name: string) {
  return name.replace(/\s*\b\d{1,2}\.\d{1,2}\.(\d{4})(\s*г\.)?\s*$/u, ' $1').trim()
}

/** The API's unit with the election's name (the country unit and the first crumb) as electionLabel. */
export function withElectionLabel<T extends { type: string; name: string; crumbs?: Crumb[] }>(unit: T): T {
  return {
    ...unit,
    name: unit.type === 'election' ? electionLabel(unit.name) : unit.name,
    ...(unit.crumbs ? { crumbs: unit.crumbs.map((crumb) => (crumb.type === 'election' ? { ...crumb, name: electionLabel(crumb.name) } : crumb)) } : {}),
  }
}

/** The unit's heading, as the results site writes it. */
export function unitTitle(data: Pick<ResultsUnit, 'type' | 'id' | 'name'>) {
  return data.type === 'electionRegion' ? `${data.id}. ${data.name}` : `${mapNodeType(data.type)} ${data.name}`
}

const EMPTY_STATS: UnitStats = {
  voters: 0,
  sectionsWithResults: 0,
  validVotes: 0,
  invalidVotes: 0,
  violationsCount: 0,
  sectionsCount: 0,
  processedViolations: 0,
  publishedViolations: 0,
  streamsCount: 0,
  highRisk: 0,
  midRisk: 0,
  populated: 0,
}

const SUMMED: (keyof UnitStats)[] = [
  'voters',
  'sectionsWithResults',
  'validVotes',
  'invalidVotes',
  'violationsCount',
  'sectionsCount',
  'processedViolations',
  'publishedViolations',
  'streamsCount',
  'highRisk',
  'midRisk',
  'populated',
]

/** Towns and addresses come without stats: sum them from their nodes (results: aggregateData). */
export function aggregateData<T extends UnitNode>(data: T): T & { stats: UnitStats } {
  const nodes = (data.nodes ?? []).map((node) => aggregateData(node))
  let stats = data.stats && Object.keys(data.stats).length > 0 ? { ...EMPTY_STATS, ...data.stats } : null
  if (!stats) {
    stats = { ...EMPTY_STATS }
    for (const node of nodes) {
      for (const key of SUMMED) (stats[key] as number) += Number(node.stats[key] ?? 0) || 0
    }
  }
  return { ...data, nodes: data.nodes ? nodes : undefined, stats }
}

// --- Map colours and tooltips (results: bulgaria_map/generateRegionData.js, generateTooltipContent.js)

export type MapMode = 'violations' | 'sectionsWithResults' | 'voters' | 'video'
export type SectionsMode = 'risk' | 'processed' | 'populated'

export const rgbGradient = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number, val: number) =>
  `rgb(${(r2 - r1) * val + r1},${(g2 - g1) * val + g1},${(b2 - b1) * val + b1})`

export interface TooltipRow {
  label: string
  value: string
}

export interface RegionDatum {
  color: string
  rows: TooltipRow[]
  publishedViolations: number
}

const safe = (value: number) => (Number.isFinite(value) ? value : 0)

export function regionData(regions: UnitNode[], mode: MapMode, sectionsMode: SectionsMode): Record<string, RegionDatum> {
  const out: Record<string, RegionDatum> = {}
  const list = regions.filter((region) => region.stats && region.id != null)
  const key = (region: UnitNode) => String(region.id)

  if (mode === 'voters') {
    const values = list.map((region) => region.stats!.voters)
    const low = Math.min(...values)
    const high = Math.max(...values)
    for (const region of list) {
      const stats = region.stats!
      out[key(region)] = {
        color: rgbGradient(202, 253, 200, 0, 255, 0, safe((stats.voters - low) / (high - low))),
        rows: [{ label: 'Избиратели', value: formatCount(stats.voters) }],
        publishedViolations: stats.publishedViolations,
      }
    }
    return out
  }

  if (mode === 'sectionsWithResults') {
    const maxHigh = Math.max(0, ...list.map((region) => region.stats!.highRisk))
    const maxMid = Math.max(0, ...list.map((region) => region.stats!.midRisk))
    for (const region of list) {
      const { highRisk, midRisk, sectionsCount, sectionsWithResults, populated, publishedViolations } = region.stats!
      let color = 'rgb(237, 237, 255)'
      if (sectionsMode === 'risk') {
        if (highRisk > 0) color = rgbGradient(201, 159, 159, 156, 20, 20, safe(((highRisk + midRisk) / (maxHigh + maxMid)) * 1.5))
        else if (midRisk > 0) color = rgbGradient(253, 235, 195, 247, 176, 13, safe((midRisk / maxMid) * 1.5))
      } else if (sectionsMode === 'processed') {
        color = rgbGradient(237, 237, 255, 10, 116, 253, safe(sectionsWithResults / sectionsCount))
      } else {
        color = rgbGradient(237, 237, 255, 10, 116, 253, safe(populated / sectionsCount))
      }
      out[key(region)] = {
        color,
        rows: [
          { label: 'Общо секции', value: formatCount(sectionsCount) },
          { label: 'Високорискови секции', value: formatCount(highRisk) },
          { label: 'Среднорискови секции', value: formatCount(midRisk) },
        ],
        publishedViolations,
      }
    }
    return out
  }

  const counts = list.map((region) => region.stats!.violationsCount)
  const low = Math.min(...counts)
  const high = Math.max(...counts)
  for (const region of list) {
    const stats = region.stats!
    out[key(region)] = {
      color: stats.violationsCount === 0 ? '#eee' : rgbGradient(239, 238, 95, 255, 0, 0, safe((stats.violationsCount - low) / (high - low))),
      rows: [
        { label: 'Общ брой сигнали', value: formatCount(stats.violationsCount ?? 0) },
        { label: 'Обработени сигнали', value: formatCount(stats.processedViolations ?? 0) },
        { label: 'Публикувани сигнали', value: formatCount(stats.publishedViolations ?? 0) },
      ],
      publishedViolations: stats.publishedViolations,
    }
  }
  return out
}

// --- Subdivision table (results: subdivision_table/sortSubdivisionTable.js)

export interface TableRow {
  node: UnitNode & { stats: UnitStats }
  percentage: number
  violationPercentage: number
  tooltipField: string
  tooltipValue: string
}

export type TableMode = 'violations' | 'sectionsWithResults' | 'voters'

function withViolationShades(rows: TableRow[]) {
  const counts = rows.map((row) => row.node.stats.violationsCount).filter((count) => count > 0)
  const max = Math.max(0, ...counts)
  const min = Math.min(...counts)
  for (const row of rows) {
    const count = row.node.stats.violationsCount
    row.violationPercentage = !count ? 0 : safe((count - min) / (max - min))
  }
  return rows
}

export function sortRows(nodes: (UnitNode & { stats: UnitStats })[], mode: TableMode, sectionsMode: SectionsMode): TableRow[] {
  // Like the results site, „Обработени“ sorts by signals (sortSubdivisionTable falls through).
  const by: 'voters' | 'highRisk' | 'populated' | 'violationsCount' =
    mode === 'voters'
      ? 'voters'
      : mode === 'sectionsWithResults' && sectionsMode === 'risk'
        ? 'highRisk'
        : mode === 'sectionsWithResults' && sectionsMode === 'populated'
          ? 'populated'
          : 'violationsCount'
  const field = {
    voters: 'Избиратели',
    highRisk: 'Високорискови секции',
    populated: 'Покрити секции',
    violationsCount: 'Подадени сигнали',
  }[by]
  const pick = (node: UnitNode & { stats: UnitStats }) => Number(node.stats[by]) || 0
  const highest = Math.max(0, ...nodes.map(pick))
  const rows = nodes.map((node) => ({
    node,
    percentage: safe(pick(node) / highest),
    violationPercentage: 0,
    tooltipField: field,
    tooltipValue: formatCount(pick(node)),
  }))
  rows.sort((a, b) => b.percentage - a.percentage)
  return withViolationShades(rows)
}

export interface RiskSegment {
  displayName: string
  color: string
  percentage: number
  count: number
}

/** results: generateSectionSegments.js */
export function sectionSegments(stats: UnitStats, sectionsMode: SectionsMode): RiskSegment[] {
  const total = stats.sectionsCount
  const share = (count: number) => safe(count / total)
  if (sectionsMode === 'populated') {
    return [
      { displayName: 'Покрити секции', color: '#0a7399', count: stats.populated, percentage: share(stats.populated) },
      { displayName: 'Непокрити секции', color: '#9C1414', count: total - stats.populated, percentage: share(total - stats.populated) },
    ]
  }
  if (sectionsMode === 'processed') {
    return [
      { displayName: 'Обработени секции', color: '#0a7399', count: stats.sectionsWithResults, percentage: share(stats.sectionsWithResults) },
      {
        displayName: 'Необработени секции',
        color: '#9C1414',
        count: total - stats.sectionsWithResults,
        percentage: share(total - stats.sectionsWithResults),
      },
    ]
  }
  const low = total - (stats.highRisk + stats.midRisk)
  return [
    { displayName: 'Висок риск', color: '#9C1414', count: stats.highRisk, percentage: share(stats.highRisk) },
    { displayName: 'Среден риск', color: '#F7B00D', count: stats.midRisk, percentage: share(stats.midRisk) },
    { displayName: 'Нисък риск', color: '#0a7399', count: low, percentage: share(low) },
  ]
}

// --- Formatting (results: Util.js)

/** 12 345 */
export function formatCount(value: number) {
  const number = Math.round(Number(value) || 0)
  return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** 12,34 */
export function formatPercentage(value: number) {
  const fixed = (100 * (Number(value) || 0)).toFixed(2)
  const [whole, fraction] = fixed.split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction}`
}

const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември']

function ordinalDay(d: number) {
  if (d >= 10 && d <= 20) return `${d}-ти`
  switch (d % 10) {
    case 1:
      return `${d}-ви`
    case 2:
      return `${d}-ри`
    case 7:
    case 8:
      return `${d}-ми`
    default:
      return `${d}-ти`
  }
}

const SOFIA_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Sofia',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** „19:42, 25-ти октомври 2026“ in Sofia time (results: formatDateTime). */
export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(SOFIA_PARTS.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.hour}:${parts.minute}, ${ordinalDay(Number(parts.day))} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`
}

export function riskLevelText(riskLevel: string | undefined) {
  switch (riskLevel) {
    case 'high':
      return 'Висок'
    case 'mid':
      return 'Среден'
    default:
      return 'Нисък'
  }
}

/** The official stream for a section on evideo.bg (results 2.7.5): the МИР page, anchored at the section. */
export function evideoUrl(section: string) {
  return `https://evideo.bg/pvr2026/${section.slice(0, 2)}.html#${section}`
}

/** results: shouldShowOfficialStreaming — from 10 minutes before the end of election day. */
export function showOfficialStreaming(meta: Pick<ElectionMeta, 'endOfElectionDayTimestamp'> | null | undefined, now = Date.now()) {
  if (!meta?.endOfElectionDayTimestamp) return false
  const end = new Date(meta.endOfElectionDayTimestamp).getTime()
  return Number.isFinite(end) && now > end - 10 * 60 * 1000
}

/** The map mode the results site starts with: signals once there are any, else sections. */
export function initialMode(stats: UnitStats | undefined): MapMode {
  return (stats?.violationsCount ?? 0) > 0 ? 'violations' : 'sectionsWithResults'
}

export function crumbHref(segment: string) {
  return segment ? `/${segment}` : '/'
}

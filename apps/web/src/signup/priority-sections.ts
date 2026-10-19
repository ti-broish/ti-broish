/**
 * Domestic priority (risk-scored) sections. One row per section code with the score R,
 * a level (e.g. quarantine / elevated / watch) and the raw component columns.
 * The list only steers staff: nothing here drafts, publishes or notifies anyone.
 */

export interface PrioritySection {
  sectionCode: string
  town: string
  municipality: string
  oblast: string
  /** Blank in the file (e.g. quarantine rows) is null and sorts after every scored section. */
  r: number | null
  level: string
  /** Every other column from the file, keyed by its header (T, U, V, …, lat, lon). */
  components: Record<string, string>
}

export interface PriorityInfo {
  r: number | null
  level: string
}

export type PriorityCoverageState = 'published' | 'draft' | 'taken' | 'open'

export interface PriorityCoverage {
  total: number
  published: number
  draft: number
  taken: number
  covered: number
  uncovered: number
  byLevel: Array<{ level: string; total: number; covered: number }>
}

const COL_SECTION = ['сик', 'секция', 'section_code', 'section', 'code']
const COL_TOWN = ['населено_място', 'town', 'град']
const COL_MUNICIPALITY = ['община', 'municipality']
const COL_OBLAST = ['област', 'oblast', 'region']
const COL_R = ['r', 'score', 'риск']
const COL_LEVEL = ['level', 'ниво']
const KNOWN = new Set([...COL_SECTION, ...COL_TOWN, ...COL_MUNICIPALITY, ...COL_OBLAST, ...COL_R, ...COL_LEVEL])

/** Most urgent level first. Unknown levels sort after these, alphabetically. */
export const PRIORITY_LEVELS = ['quarantine', 'elevated', 'watch'] as const

const LEVEL_LABEL: Record<string, string> = {
  quarantine: 'карантина',
  elevated: 'повишен',
  watch: 'наблюдение',
}

export function priorityLevelLabel(level: string) {
  return LEVEL_LABEL[level.trim().toLowerCase()] ?? level
}

export function levelRank(level: string) {
  const index = (PRIORITY_LEVELS as readonly string[]).indexOf(level.trim().toLowerCase())
  return index === -1 ? PRIORITY_LEVELS.length : index
}

export function priorityCode(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length === 8 ? `0${digits}` : digits
}

/** For sorting: a blank R ranks below every score. */
export function rKey(r: number | null | undefined) {
  return typeof r === 'number' && Number.isFinite(r) ? r : Number.NEGATIVE_INFINITY
}

function byRDesc(a: number | null | undefined, b: number | null | undefined) {
  const x = rKey(a)
  const y = rKey(b)
  return x === y ? 0 : y > x ? 1 : -1
}

/** Higher R first (blank R last), then the more urgent level, then the code. */
export function comparePriority(a: { r: number | null; level: string; sectionCode: string }, b: { r: number | null; level: string; sectionCode: string }) {
  return byRDesc(a.r, b.r) || levelRank(a.level) - levelRank(b.level) || a.sectionCode.localeCompare(b.sectionCode)
}

/** Parse the semicolon (or comma) separated file. A BOM, quotes and decimal commas are accepted. */
export function parsePriorityCsv(text: string): { rows: PrioritySection[]; errors: string[]; rejected: number; duplicates: number } {
  const source = text.replace(/^\uFEFF/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const grid = parseGrid(source, delimiter)
  if (grid.length === 0) return { rows: [], errors: ['Файлът е празен.'], rejected: 0, duplicates: 0 }
  const rawHeaders = grid[0].map((header) => header.trim().replace(/^\uFEFF/, ''))
  const keys = rawHeaders.map(headerKey)
  const sectionIndex = keys.findIndex((key) => COL_SECTION.includes(key))
  const rIndex = keys.findIndex((key) => COL_R.includes(key))
  if (sectionIndex === -1 || rIndex === -1) {
    return { rows: [], errors: ['Първият ред трябва да има колони „СИК“ и „R“.'], rejected: 0, duplicates: 0 }
  }
  const find = (names: string[]) => keys.findIndex((key) => names.includes(key))
  const townIndex = find(COL_TOWN)
  const municipalityIndex = find(COL_MUNICIPALITY)
  const oblastIndex = find(COL_OBLAST)
  const levelIndex = find(COL_LEVEL)

  const byCode = new Map<string, PrioritySection>()
  const errors: string[] = []
  let rejected = 0
  let duplicates = 0
  grid.slice(1).forEach((cells, index) => {
    const line = index + 2
    const cell = (at: number) => (at >= 0 ? (cells[at] ?? '').trim() : '')
    const sectionCode = priorityCode(cell(sectionIndex))
    if (!/^\d{9}$/.test(sectionCode)) {
      errors.push(`Ред ${line}: СИК трябва да е 9 цифри.`)
      rejected += 1
      return
    }
    if (sectionCode.startsWith('32')) {
      errors.push(`Ред ${line}: ${sectionCode} е в чужбина. Те се качват в „Чужбина“.`)
      rejected += 1
      return
    }
    const rawR = cell(rIndex).replace(',', '.')
    const r = rawR === '' ? null : Number(rawR)
    if (r !== null && !Number.isFinite(r)) {
      errors.push(`Ред ${line}: R не е число.`)
      rejected += 1
      return
    }
    const components: Record<string, string> = {}
    keys.forEach((key, at) => {
      if (KNOWN.has(key)) return
      const value = cell(at)
      if (value) components[rawHeaders[at]] = value
    })
    if (byCode.has(sectionCode)) duplicates += 1
    byCode.set(sectionCode, {
      sectionCode,
      town: cell(townIndex),
      municipality: cell(municipalityIndex),
      oblast: cell(oblastIndex),
      r,
      level: cell(levelIndex).toLowerCase(),
      components,
    })
  })
  const rows = [...byCode.values()].sort(comparePriority)
  return { rows, errors, rejected, duplicates }
}

/** How a priority section is covered right now. Published beats a draft beats another organisation. */
export function coverageState(code: string, published: ReadonlySet<string>, drafts: ReadonlySet<string>, taken: ReadonlySet<string>): PriorityCoverageState {
  if (published.has(code)) return 'published'
  if (drafts.has(code)) return 'draft'
  if (taken.has(code)) return 'taken'
  return 'open'
}

export function summarizePriorityCoverage(
  rows: Array<Pick<PrioritySection, 'sectionCode' | 'level'>>,
  published: ReadonlySet<string>,
  drafts: ReadonlySet<string>,
  taken: ReadonlySet<string> = new Set(),
): PriorityCoverage {
  const summary: PriorityCoverage = { total: 0, published: 0, draft: 0, taken: 0, covered: 0, uncovered: 0, byLevel: [] }
  const levels = new Map<string, { level: string; total: number; covered: number }>()
  for (const row of rows) {
    const state = coverageState(row.sectionCode, published, drafts, taken)
    summary.total += 1
    if (state === 'open') summary.uncovered += 1
    else {
      summary.covered += 1
      summary[state] += 1
    }
    const level = levels.get(row.level) ?? { level: row.level, total: 0, covered: 0 }
    level.total += 1
    if (state !== 'open') level.covered += 1
    levels.set(row.level, level)
  }
  summary.byLevel = [...levels.values()].sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.level.localeCompare(b.level))
  return summary
}

/** Open sections first, each group by R desc. */
export function sortForAssignment<T extends { sectionCode: string; r: number | null; level: string; state: PriorityCoverageState }>(rows: T[]) {
  return [...rows].sort((a, b) => Number(a.state !== 'open') - Number(b.state !== 'open') || comparePriority(a, b))
}

export function foldPlace(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('bg')
    .replace(/^(гр|с)\.\s*/, '')
    .replace(/^(гр|с)\s+/, '')
    .replace(/\s+/g, ' ')
}

/** Best priority R reachable for a person at home: same town first, else the same municipality. */
export function personPriorityReach(
  person: { town?: string; municipality?: string; mir?: string },
  rows: Array<Pick<PrioritySection, 'sectionCode' | 'town' | 'municipality' | 'r' | 'level'>>,
  blocked: ReadonlySet<string> = new Set(),
) {
  const town = foldPlace(person.town ?? '')
  const municipality = foldPlace(person.municipality ?? '')
  const mir = (person.mir ?? '').trim().padStart(2, '0')
  let inTown = 0
  let inMunicipality = 0
  let best: { r: number | null; level: string; scope: 'town' | 'municipality' } | null = null
  for (const row of rows) {
    if (blocked.has(row.sectionCode)) continue
    if (person.mir && row.sectionCode.slice(0, 2) !== mir) continue
    const sameMunicipality = Boolean(municipality) && foldPlace(row.municipality) === municipality
    const sameTown = Boolean(town) && foldPlace(row.town) === town && (sameMunicipality || !municipality)
    if (!sameTown && !sameMunicipality) continue
    if (sameTown) inTown += 1
    else inMunicipality += 1
    const scope = sameTown ? 'town' : 'municipality'
    if (!best || (scope === 'town' && best.scope === 'municipality') || (scope === best.scope && rKey(row.r) > rKey(best.r))) {
      best = { r: row.r, level: row.level, scope }
    }
  }
  return { inTown, inMunicipality, best }
}

export interface RankedSuggestion {
  id: string
  place: string
  score: number
  reason: string
  desk: 'paper' | 'machine' | 'unknown'
  priority?: PriorityInfo & { scope: 'town' | 'municipality' | 'other' }
}

/**
 * Put priority sections first: those in the person's town, then the rest of the municipality,
 * each by R desc; then the ordinary suggestions by their score. Blocked codes never appear.
 */
export function rankWithPriority(
  suggestions: Array<Omit<RankedSuggestion, 'priority'>>,
  rows: Array<Pick<PrioritySection, 'sectionCode' | 'town' | 'municipality' | 'r' | 'level'>>,
  person: { town?: string; municipality?: string; mir?: string },
  blocked: ReadonlySet<string>,
  limit = 8,
): RankedSuggestion[] {
  const town = foldPlace(person.town ?? '')
  const municipality = foldPlace(person.municipality ?? '')
  const mir = (person.mir ?? '').trim() ? (person.mir ?? '').trim().padStart(2, '0') : ''
  const byCode = new Map(rows.map((row) => [row.sectionCode, row]))
  const scopeOf = (row: Pick<PrioritySection, 'town' | 'municipality'>): 'town' | 'municipality' | 'other' => {
    const sameMunicipality = Boolean(municipality) && foldPlace(row.municipality) === municipality
    if (town && foldPlace(row.town) === town && (sameMunicipality || !municipality)) return 'town'
    if (sameMunicipality) return 'municipality'
    return 'other'
  }
  const out: RankedSuggestion[] = []
  const seen = new Set<string>()
  for (const suggestion of suggestions) {
    if (blocked.has(suggestion.id) || seen.has(suggestion.id)) continue
    seen.add(suggestion.id)
    const row = byCode.get(suggestion.id)
    if (!row) {
      out.push(suggestion)
      continue
    }
    const scope = scopeOf(row) === 'municipality' ? 'municipality' : 'town'
    out.push({ ...suggestion, reason: `приоритет ${priorityLevelLabel(row.level)} R ${formatR(row.r)} · ${suggestion.reason}`, priority: { r: row.r, level: row.level, scope } })
  }
  for (const row of rows) {
    if (seen.has(row.sectionCode) || blocked.has(row.sectionCode)) continue
    if (mir && row.sectionCode.slice(0, 2) !== mir) continue
    const scope = scopeOf(row)
    if (scope === 'other') continue
    seen.add(row.sectionCode)
    out.push({
      id: row.sectionCode,
      place: row.town,
      score: 0,
      reason: `приоритет ${priorityLevelLabel(row.level)} R ${formatR(row.r)} · ${scope === 'town' ? 'град' : 'община'}`,
      desk: 'unknown',
      priority: { r: row.r, level: row.level, scope },
    })
  }
  const scopeRank = (item: RankedSuggestion) => (!item.priority ? 2 : item.priority.scope === 'town' ? 0 : 1)
  out.sort((a, b) =>
    scopeRank(a) - scopeRank(b)
    || (a.priority && b.priority ? byRDesc(a.priority.r, b.priority.r) : 0)
    || b.score - a.score
    || a.id.localeCompare(b.id),
  )
  return out.slice(0, limit)
}

export function formatR(r: number | null | undefined) {
  if (typeof r !== 'number' || !Number.isFinite(r)) return '—'
  return (Math.round(r * 100) / 100).toFixed(2)
}

function headerKey(value: string) {
  return value.trim().replace(/^\uFEFF/, '').toLocaleLowerCase('bg').replace(/[\s-]+/g, '_')
}

function parseGrid(source: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') cell += char
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((item) => item.some((value) => value.trim()))
}

/**
 * People in the sections table, tied to priority sections. `reach` is the best open priority section
 * at home (town, else municipality). `only` keeps people whose draft/published section is priority,
 * or who have none published yet and an open priority section at home. `sort` puts them first by R desc.
 */
export function orderByPriority<P extends { draftSection: string; publishedSection: string; town?: string; municipality?: string; mir?: string; region?: string }>(
  people: P[],
  rows: Array<Pick<PrioritySection, 'sectionCode' | 'town' | 'municipality' | 'r' | 'level'> & { state?: PriorityCoverageState }>,
  options: { only: boolean; sort: boolean },
) {
  const byCode = new Map(rows.map((row) => [row.sectionCode, row]))
  const open = rows.filter((row) => !row.state || row.state === 'open')
  const items = people.map((person, index) => {
    const own = byCode.get(priorityCode(person.publishedSection)) ?? byCode.get(priorityCode(person.draftSection)) ?? null
    const abroad = person.region === '32' || person.mir === '32'
    const found = abroad || person.publishedSection ? null : personPriorityReach(person, open).best
    const reach = found ? { r: found.r, level: found.level, scope: found.scope } : null
    // Tied people come before untied ones; a blank R still beats no priority at all.
    const key = own ? rKey(own.r) : reach ? rKey(reach.r) : null
    return { person, reach, key, tied: Boolean(own || reach), index }
  })
  const kept = options.only ? items.filter((item) => item.tied) : items
  if (options.sort) {
    kept.sort((a, b) => {
      if (a.key === null || b.key === null) return (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) || a.index - b.index
      return (a.key === b.key ? 0 : b.key > a.key ? 1 : -1) || a.index - b.index
    })
  }
  return kept.map(({ person, reach }) => ({ person, reach }))
}

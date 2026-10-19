import { normalizeSection } from './admin-csv'

export type AbroadTierLetter = 'A' | 'B' | 'C' | 'D'

/** Lower rank = send volunteers first (fill C gaps before A). */
export const TIER_RANK: Record<AbroadTierLetter, number> = {
  C: 0,
  D: 1,
  B: 2,
  A: 3,
}

export interface AbroadPriorityRow {
  sectionCode: string
  country: string
  city: string
  placeLabel: string
  members: number
  tier: string
  tierLetter: AbroadTierLetter
  ppdbSeats: number
  daSeats: number
  ppdbSeatsWithoutNominee: number
  partySeatsAllocatedInFile: number
}

const COL_SECTION = ['section_code', 'секция', 'section', 'code', 'номер']
const COL_COUNTRY = ['country', 'държава', 'state']
const COL_CITY = ['city', 'град', 'town']
const COL_PLACE = ['place_label', 'място', 'place', 'етикет', 'label']
const COL_MEMBERS = ['members', 'членове', 'хора']
const COL_TIER = ['tier', 'ниво', 'приоритет', 'priority']
const COL_PPDB = ['ppdb_seats', 'ppdb']
const COL_DA = ['da_seats', 'da']
const COL_PPDB_WITHOUT = ['ppdb_seats_without_nominee', 'ppdb_without_nominee']
const COL_PARTY = ['party_seats_allocated_in_file', 'party_seats', 'allocated']

export function tierLetterOf(tier: string): AbroadTierLetter | null {
  const letter = tier.trim().charAt(0).toUpperCase()
  if (letter === 'A' || letter === 'B' || letter === 'C' || letter === 'D') return letter
  return null
}

export function isAbroadSectionCode(code: string): boolean {
  const normalized = normalizeSection(code)
  return /^32\d{7}$/.test(normalized)
}

export function compareAbroadSections(
  a: { tierLetter: AbroadTierLetter; sectionCode: string },
  b: { tierLetter: AbroadTierLetter; sectionCode: string },
): number {
  const rank = TIER_RANK[a.tierLetter] - TIER_RANK[b.tierLetter]
  if (rank !== 0) return rank
  return a.sectionCode.localeCompare(b.sectionCode)
}

export function parsePrioritySectionsCsv(text: string): {
  rows: AbroadPriorityRow[]
  errors: string[]
  imported: number
  rejected: number
} {
  const table = parseTable(text)
  if (!table.headers.some((header) => COL_SECTION.includes(header))) {
    return { rows: [], errors: ['Първият ред трябва да има колона „section_code“.'], imported: 0, rejected: 0 }
  }

  const rows: AbroadPriorityRow[] = []
  const errors: string[] = []
  let rejected = 0

  table.rows.forEach((row, index) => {
    const line = index + 2
    const sectionCode = normalizeSection(pick(row, COL_SECTION))
    if (!isAbroadSectionCode(sectionCode)) {
      errors.push(`Ред ${line}: секцията трябва да е 32########.`)
      rejected += 1
      return
    }

    const tier = pick(row, COL_TIER)
    const tierLetter = tierLetterOf(tier)
    if (!tierLetter) {
      errors.push(`Ред ${line}: неизвестен tier „${tier || '(празно)'}“.`)
      rejected += 1
      return
    }

    rows.push({
      sectionCode,
      country: pick(row, COL_COUNTRY),
      city: pick(row, COL_CITY),
      placeLabel: pick(row, COL_PLACE),
      members: intOrZero(pick(row, COL_MEMBERS)),
      tier,
      tierLetter,
      ppdbSeats: intOrZero(pick(row, COL_PPDB)),
      daSeats: intOrZero(pick(row, COL_DA)),
      ppdbSeatsWithoutNominee: intOrZero(pick(row, COL_PPDB_WITHOUT)),
      partySeatsAllocatedInFile: intOrZero(pick(row, COL_PARTY)),
    })
  })

  return { rows, errors, imported: rows.length, rejected }
}

export function summarizeCoverage(rows: AbroadPriorityRow[]): {
  total: number
  byTier: Record<AbroadTierLetter, number>
  byCountry: Array<{ country: string; count: number }>
} {
  const byTier: Record<AbroadTierLetter, number> = { A: 0, B: 0, C: 0, D: 0 }
  const countryCounts = new Map<string, number>()
  for (const row of rows) {
    byTier[row.tierLetter] += 1
    const key = row.country.trim() || '(без държава)'
    countryCounts.set(key, (countryCounts.get(key) ?? 0) + 1)
  }
  const byCountry = [...countryCounts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country, 'bg'))
  return { total: rows.length, byTier, byCountry }
}

function intOrZero(value: string) {
  const parsed = Number.parseInt(value.replace(/\s+/g, ''), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseTable(text: string) {
  const grid = parseCsv(text)
  if (grid.length === 0) return { headers: [] as string[], rows: [] as Record<string, string>[] }
  const headers = grid[0]?.map(headerKey) ?? []
  const rows = grid.slice(1).map((cells) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? '').trim()
    })
    return record
  })
  return { headers, rows }
}

function pick(row: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = row[headerKey(name)]
    if (value) return value
  }
  return ''
}

function headerKey(value: string) {
  return value.trim().toLowerCase().replace(/^\uFEFF/, '').replace(/[\s-]+/g, '_')
}

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
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
    else if (char === ',') {
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

/**
 * Sections reserved by other organisations. Stored in the existing `taken_sections` table
 * („Заети секции“), which already blocked publishing; now nothing may draft, publish or
 * suggest them either. Existing assignments on a reserved section are kept and listed as conflicts.
 */

export interface ReservedRow {
  sectionCode: string
  organisation: string
  note: string
  place: string
  line: number
}

export interface ExistingReservation {
  sectionCode: string
  organisation: string
  note?: string
  place?: string
}

export interface AssignedPerson {
  id: string
  email: string
  name: string
  draftSection: string
  publishedSection: string
}

export interface ReservationConflict {
  sectionCode: string
  organisation: string
  personId: string
  email: string
  name: string
  kind: 'published' | 'draft'
}

export type ReserveMode = 'merge' | 'replace'

export interface ReservationPlan {
  mode: ReserveMode
  organisation: string
  rows: ReservedRow[]
  add: ReservedRow[]
  update: ReservedRow[]
  unchanged: ReservedRow[]
  moved: Array<ReservedRow & { from: string }>
  remove: ExistingReservation[]
  unknown: string[]
  invalid: Array<{ line: number; value: string; reason: string }>
  duplicates: Array<{ sectionCode: string; lines: number[] }>
  conflicts: ReservationConflict[]
  /** Rows skipped because the „И аз“ partner allocation manages that section. */
  managed: ReservedRow[]
  errors: string[]
}

/** „И аз“ reservations come from the partner allocation (Секции → „И аз“), never from a file. */
export const MANAGED_ORG = 'И аз'

export function isManagedOrg(organisation: string) {
  return sameOrg(organisation.replace(/[„“"]/g, ''), MANAGED_ORG)
}

const COL_CODE = ['сик', 'секция', 'section', 'section_code', 'code', 'код', 'номер', 'номер_на_секция']
const COL_ORG = ['организация', 'org', 'organisation', 'organization', 'партия', 'резервирана_от', 'reserved_by']
const COL_NOTE = ['бележка', 'note', 'notes', 'коментар', 'comment']
const COL_PLACE = ['място', 'place', 'адрес', 'address']

export function cleanOrg(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function sameOrg(a: string, b: string) {
  return cleanOrg(a).toLocaleLowerCase('bg') === cleanOrg(b).toLocaleLowerCase('bg')
}

/** 9 digits; a lost leading zero (8 digits from a spreadsheet) is restored. Anything else is ''. */
export function reservedCode(value: string) {
  const trimmed = value.trim()
  if (!/^[\d\s.-]+$/.test(trimmed)) return ''
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 8) return `0${digits}`
  return digits.length === 9 ? digits : ''
}

export function reservedMessage(code: string, organisation: string) {
  return `Секция ${code} е резервирана от ${organisation}. Там не записваме наши хора.`
}

/**
 * Lenient parse: `;`, `,` or tab; with or without a header row; a code-only file takes the
 * organisation from the form. The first occurrence of a code wins; repeats are reported.
 */
export function parseReservedCsv(text: string, formOrg = '') {
  const source = text.replace(/^\uFEFF/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [';', '\t', ','].reduce((best, candidate) =>
    (firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best), ';')
  const grid = parseGrid(source, delimiter)
  const rows: ReservedRow[] = []
  const invalid: ReservationPlan['invalid'] = []
  const seen = new Map<string, number[]>()
  if (grid.length === 0) return { rows, invalid, duplicates: [], errors: ['Файлът е празен.'] }

  const keys = grid[0].map(headerKey)
  const hasHeader = !reservedCode(grid[0][0] ?? '') && keys.some((key) => COL_CODE.includes(key))
  if (!hasHeader && !reservedCode(grid[0][0] ?? '')) {
    return { rows, invalid, duplicates: [], errors: ['Първата колона трябва да е СИК (9 цифри) или заглавие „СИК“/„секция“.'] }
  }
  const at = (names: string[], fallback: number) => {
    if (!hasHeader) return fallback
    return keys.findIndex((key) => names.includes(key))
  }
  const codeAt = at(COL_CODE, 0)
  const orgAt = at(COL_ORG, 1)
  const noteAt = at(COL_NOTE, 2)
  const placeAt = at(COL_PLACE, -1)
  const fallbackOrg = cleanOrg(formOrg)

  grid.slice(hasHeader ? 1 : 0).forEach((cells, index) => {
    const line = index + (hasHeader ? 2 : 1)
    const cell = (position: number) => (position >= 0 ? (cells[position] ?? '').trim() : '')
    const raw = cell(codeAt)
    const sectionCode = reservedCode(raw)
    if (!sectionCode) {
      invalid.push({ line, value: raw, reason: 'СИК трябва да е 9 цифри.' })
      return
    }
    const organisation = cleanOrg(cell(orgAt)) || fallbackOrg
    if (!organisation) {
      invalid.push({ line, value: raw, reason: 'Няма организация: добави колона или я напиши във формата.' })
      return
    }
    const lines = seen.get(sectionCode)
    if (lines) {
      lines.push(line)
      return
    }
    seen.set(sectionCode, [line])
    rows.push({ sectionCode, organisation, note: cell(noteAt).slice(0, 500), place: cell(placeAt).slice(0, 300), line })
  })
  const duplicates = [...seen.entries()].filter(([, lines]) => lines.length > 1).map(([sectionCode, lines]) => ({ sectionCode, lines }))
  return { rows, invalid, duplicates, errors: [] as string[] }
}

export function conflictsFor(reserved: Map<string, string>, people: AssignedPerson[]): ReservationConflict[] {
  const out: ReservationConflict[] = []
  for (const person of people) {
    const published = reservedCode(person.publishedSection)
    const draft = reservedCode(person.draftSection)
    if (published && reserved.has(published)) {
      out.push({ sectionCode: published, organisation: reserved.get(published)!, personId: person.id, email: person.email, name: person.name, kind: 'published' })
    }
    if (draft && draft !== published && reserved.has(draft)) {
      out.push({ sectionCode: draft, organisation: reserved.get(draft)!, personId: person.id, email: person.email, name: person.name, kind: 'draft' })
    }
  }
  return out.sort((a, b) => a.sectionCode.localeCompare(b.sectionCode) || a.email.localeCompare(b.email))
}

/** What a commit would do. Pure, so the preview and the commit always agree. */
export function planReservations(input: {
  csv: string
  formOrg: string
  mode: ReserveMode
  existing: ExistingReservation[]
  people: AssignedPerson[]
  isKnown: (code: string) => boolean
  /** Sections a „И аз“ partner person holds (draft or published). */
  managed?: ReadonlySet<string>
}): ReservationPlan {
  const parsed = parseReservedCsv(input.csv, input.formOrg)
  const organisation = cleanOrg(input.formOrg)
  const errors = [...parsed.errors]
  if (organisation && isManagedOrg(organisation)) {
    errors.push('Резервациите на „И аз“ се правят от разпределението „И аз“ в Секции, не от файл.')
  }
  const managedOrgRow = parsed.rows.find((row) => isManagedOrg(row.organisation))
  if (managedOrgRow && !errors.length) {
    errors.push(`Ред ${managedOrgRow.line}: резервациите на „И аз“ се правят от разпределението „И аз“ в Секции, не от файл.`)
  }
  if (input.mode === 'replace') {
    if (!organisation) errors.push('За „Замени списъка на организацията“ напиши организацията във формата.')
    const other = parsed.rows.find((row) => !sameOrg(row.organisation, organisation))
    if (organisation && other) errors.push(`Ред ${other.line}: организацията „${other.organisation}“ не е „${organisation}“. При замяна файлът е само за една организация.`)
  }
  const existing = new Map(input.existing.map((row) => [row.sectionCode, row]))
  const plan: ReservationPlan = {
    mode: input.mode,
    organisation,
    rows: parsed.rows,
    add: [],
    update: [],
    unchanged: [],
    moved: [],
    remove: [],
    unknown: parsed.rows.filter((row) => !input.isKnown(row.sectionCode)).map((row) => row.sectionCode),
    invalid: parsed.invalid,
    duplicates: parsed.duplicates,
    conflicts: [],
    managed: [],
    errors,
  }
  for (const row of parsed.rows) {
    const current = existing.get(row.sectionCode)
    // Never overwrite an „И аз“ reservation or a section a partner person holds: skip and list it.
    if ((current && isManagedOrg(current.organisation)) || input.managed?.has(row.sectionCode)) {
      plan.managed.push(row)
      continue
    }
    if (!current) plan.add.push(row)
    else if (!sameOrg(current.organisation, row.organisation)) plan.moved.push({ ...row, from: current.organisation })
    else if ((current.note ?? '') !== row.note || (row.place && (current.place ?? '') !== row.place) || current.organisation !== row.organisation) plan.update.push(row)
    else plan.unchanged.push(row)
  }
  if (input.mode === 'replace' && organisation) {
    const keep = new Set(parsed.rows.map((row) => row.sectionCode))
    plan.remove = input.existing.filter((row) => sameOrg(row.organisation, organisation) && !isManagedOrg(row.organisation) && !keep.has(row.sectionCode))
  }
  const after = new Map(input.existing.map((row) => [row.sectionCode, row.organisation]))
  for (const row of plan.remove) after.delete(row.sectionCode)
  const written = [...plan.add, ...plan.update, ...plan.unchanged, ...plan.moved]
  for (const row of written) after.set(row.sectionCode, row.organisation)
  const touched = new Set(written.map((row) => row.sectionCode))
  plan.conflicts = conflictsFor(after, input.people).filter((conflict) => touched.has(conflict.sectionCode))
  return plan
}

export function describePlan(plan: ReservationPlan) {
  const parts = [
    `нови ${plan.add.length}`,
    `обновени ${plan.update.length}`,
    `без промяна ${plan.unchanged.length}`,
  ]
  if (plan.moved.length) parts.push(`от друга организация ${plan.moved.length}`)
  if (plan.remove.length) parts.push(`махаме ${plan.remove.length}`)
  if (plan.invalid.length) parts.push(`невалидни ${plan.invalid.length}`)
  if (plan.duplicates.length) parts.push(`повторени ${plan.duplicates.length}`)
  if (plan.unknown.length) parts.push(`непознати кодове ${plan.unknown.length}`)
  if (plan.conflicts.length) parts.push(`с наши хора ${plan.conflicts.length}`)
  if (plan.managed.length) parts.push(`пропуснати, „И аз“ ${plan.managed.length}`)
  return parts.join(' · ')
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

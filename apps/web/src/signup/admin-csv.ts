export type RosterView = 'all' | 'finished' | 'started' | 'assigned' | 'unassigned' | 'draft' | 'abroad' | 'mir' | 'calls'

export interface RosterFields {
  id: string
  email: string
  firstName: string
  middleName: string
  lastName: string
  phone: string
  mir: string
  region: string
  town: string
  place: string
  role: string
  submitted: boolean
  withdrawn: boolean
  emailConfirmed: boolean
  imported: boolean
  draftSection: string
  publishedSection: string
  egn: string
  notes: string
  callRequestedAt: string
  callMessage: string
  staffNote: string
  staffCalledAt: string
  staffCalledBy: string
  radius?: string
  travelLabel?: string
}

export interface TakenImport {
  sectionCode: string
  mirCode: string
  place: string
  organisation: string
  note: string
}

export interface PersonImport {
  firstName: string
  middleName: string
  lastName: string
  email: string
  phone: string
  mir: string
  place: string
  note: string
  role: string
}

const CAMPAIGN_HEADERS = ['email', 'first_name', 'last_name', 'phone', 'mir', 'place', 'published_section', 'role', 'notes', 'call_requested', 'call_message']
const INTERNAL_HEADERS = [
  'email',
  'first_name',
  'middle_name',
  'last_name',
  'phone',
  'mir',
  'region',
  'town',
  'place',
  'role',
  'submitted',
  'withdrawn',
  'email_confirmed',
  'imported',
  'draft_section',
  'published_section',
  'egn_last4',
  'notes',
  'call_requested',
  'call_message',
  'staff_called',
  'staff_note',
]

const TAKEN_SECTION = ['секция', 'section', 'code', 'номер', 'section_code']
const TAKEN_ORG = ['организация', 'organisation', 'organization']
const PERSON_EMAIL = ['имейл', 'email', 'e_mail', 'mail']

export function visibleSection(published: string | null | undefined) {
  const value = published?.trim() ?? ''
  return value || null
}

export function egnLast4(egn: string | null | undefined) {
  const digits = (egn ?? '').replace(/\D/g, '')
  if (digits.length < 4) return ''
  return digits.slice(-4)
}

export function normalizeSection(value: string) {
  return value.trim().replace(/\s+/g, '').toUpperCase()
}

export function mirFromSection(code: string) {
  const digits = code.replace(/\D/g, '')
  if (digits.length < 8) return ''
  return digits.slice(0, 2)
}

export function rosterWhere(view: RosterView, mir: string): { clause: string; binds: string[] } | { error: string } {
  if (view === 'finished') return { clause: 'COALESCE(submitted, 0) = 1 AND COALESCE(withdrawn, 0) = 0', binds: [] }
  if (view === 'started') return { clause: 'COALESCE(submitted, 0) = 0 AND COALESCE(withdrawn, 0) = 0', binds: [] }
  if (view === 'assigned') return { clause: "COALESCE(published_section, '') != ''", binds: [] }
  if (view === 'unassigned') return { clause: "COALESCE(published_section, '') = '' AND COALESCE(withdrawn, 0) = 0", binds: [] }
  if (view === 'draft') return { clause: "COALESCE(draft_section, '') != '' AND COALESCE(draft_section, '') != COALESCE(published_section, '')", binds: [] }
  if (view === 'abroad') return { clause: "region_code = '32'", binds: [] }
  if (view === 'calls') {
    return {
      clause: "COALESCE(json_extract(payload, '$.callRequestedAt'), '') != '' AND COALESCE(withdrawn, 0) = 0",
      binds: [],
    }
  }
  if (view === 'mir') {
    const code = mir.trim()
    if (!/^\d{1,2}$/.test(code)) return { error: 'МИР е номер, например 23.' }
    return { clause: 'mir_code = ?', binds: [code.padStart(2, '0')] }
  }
  return { clause: '1 = 1', binds: [] }
}

export function campaignCsv(people: RosterFields[]) {
  return toCsv(CAMPAIGN_HEADERS, people.map(campaignCells))
}

export function internalCsv(people: RosterFields[]) {
  return toCsv(INTERNAL_HEADERS, people.map(internalCells))
}

export function parseTakenCsv(text: string): { rows: TakenImport[]; errors: string[] } {
  const table = parseTable(text)
  if (!table.headers.some((header) => TAKEN_SECTION.includes(header))) {
    return { rows: [], errors: ['Първият ред трябва да има колона „секция“.'] }
  }
  const rows: TakenImport[] = []
  const errors: string[] = []
  table.rows.forEach((row, index) => {
    const sectionCode = normalizeSection(pick(row, TAKEN_SECTION))
    const organisation = pick(row, TAKEN_ORG)
    if (!sectionCode || !organisation) {
      errors.push(`Ред ${index + 2}: нужни са секция и организация.`)
      return
    }
    const mirCode = pick(row, ['мир', 'mir', 'mir_code']) || mirFromSection(sectionCode)
    rows.push({
      sectionCode,
      mirCode,
      place: pick(row, ['място', 'place', 'адрес', 'address']),
      organisation,
      note: pick(row, ['бележка', 'note', 'notes']),
    })
  })
  return { rows, errors }
}

export function parsePeopleCsv(text: string): { rows: PersonImport[]; errors: string[] } {
  const table = parseTable(text)
  if (!table.headers.some((header) => PERSON_EMAIL.includes(header))) {
    return { rows: [], errors: ['Първият ред трябва да има колона „имейл“.'] }
  }
  const rows: PersonImport[] = []
  const errors: string[] = []
  table.rows.forEach((row, index) => {
    const email = pick(row, PERSON_EMAIL).toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Ред ${index + 2}: имейлът не е валиден.`)
      return
    }
    rows.push({
      firstName: pick(row, ['име', 'first', 'first_name', 'firstname']),
      middleName: pick(row, ['презиме', 'middle', 'middle_name']),
      lastName: pick(row, ['фамилия', 'last', 'last_name', 'lastname']),
      email,
      phone: pick(row, ['телефон', 'phone', 'tel']),
      mir: pick(row, ['мир', 'mir', 'mir_code']),
      place: pick(row, ['място', 'place', 'адрес']),
      note: pick(row, ['бележка', 'note', 'notes']),
      role: pick(row, ['роля', 'role']),
    })
  })
  return { rows, errors }
}

function campaignCells(person: RosterFields) {
  return [
    person.email,
    person.firstName,
    person.lastName,
    person.phone,
    person.mir,
    person.place,
    person.publishedSection,
    person.role,
    person.notes,
    person.callRequestedAt ? '1' : '0',
    person.callMessage,
  ]
}

function internalCells(person: RosterFields) {
  return [
    person.email,
    person.firstName,
    person.middleName,
    person.lastName,
    person.phone,
    person.mir,
    person.region,
    person.town,
    person.place,
    person.role,
    person.submitted ? '1' : '0',
    person.withdrawn ? '1' : '0',
    person.emailConfirmed ? '1' : '0',
    person.imported ? '1' : '0',
    person.draftSection,
    person.publishedSection,
    egnLast4(person.egn),
    person.notes,
    person.callRequestedAt ? '1' : '0',
    person.callMessage,
    person.staffCalledAt ? '1' : '0',
    person.staffNote,
  ]
}

export function toCsv(headers: string[], rows: string[][]) {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
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

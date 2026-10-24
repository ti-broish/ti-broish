// „Секции с хора“ (admins): one row per person for every section that has at least one assigned
// person, ours or „И аз“. The columns of the 23.10.2026 one-off file „всички секции + хора“, minus
// the sections nobody holds. Never the ЕГН. Read-only: built from D1 plus the CIK section fixture.
import { normalizeSection, toCsv } from './admin-csv'
import { partnerActiveSql } from './partner-roster'
import { priorityLevelLabel } from './priority-sections'
import { PAPER_VOTERS_MAX } from './sections'

export const SECTIONS_PEOPLE_HEADERS = [
  'СИК',
  '№ секция',
  'МИР',
  'Област / Държава',
  'Община',
  'Населено място',
  'Адрес',
  'Вид (хартия/машина)',
  'Приоритет (R / ниво)',
  'Заета от друга организация',
  'Брой хора',
  'Източник',
  'Име',
  'Роля',
  'Телефон',
  'Имейл',
  'Статус на разпределение',
  'Пълномощно (МИР/№)',
] as const

/**
 * Every active (not withdrawn) volunteer holding a section, draft or published: the rule of the
 * 23.10 file and of the section quota (a draft holds the section too). No ЕГН column, on purpose.
 */
export const SECTIONS_PEOPLE_SIGNUPS_SQL = `SELECT id,
  COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
  COALESCE(json_extract(payload, '$.middleName'), '') AS middle_name,
  COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
  COALESCE(json_extract(payload, '$.phone'), '') AS phone,
  COALESCE(email, '') AS email, COALESCE(role, '') AS role, COALESCE(coordinator, 0) AS coordinator,
  COALESCE(draft_section, '') AS draft_section, COALESCE(published_section, '') AS published_section,
  COALESCE(designation_mir, '') AS designation_mir, designation_number
FROM signups
WHERE COALESCE(withdrawn, 0) = 0
  AND (COALESCE(published_section, '') != '' OR COALESCE(draft_section, '') != '')`

/**
 * Every active „И аз“ person holding a section, draft or published, as in the 23.10 file. Not the
 * list's „covered by a volunteer“ filter: a covered row that still holds its own section is a
 * section with a person, so it stays. No ЕГН.
 */
export const SECTIONS_PEOPLE_PARTNERS_SQL = `SELECT p.id, COALESCE(p.partner, '') AS partner,
  COALESCE(p.first_name, '') AS first_name, COALESCE(p.middle_name, '') AS middle_name, COALESCE(p.last_name, '') AS last_name,
  COALESCE(p.phone, '') AS phone, COALESCE(p.email, '') AS email,
  COALESCE(p.section_draft, '') AS section_draft, COALESCE(p.section_published, '') AS section_published,
  COALESCE(p.designation_mir, '') AS designation_mir, p.designation_number
FROM partner_people p
WHERE ${partnerActiveSql('p')}
  AND (COALESCE(p.section_published, '') != '' OR COALESCE(p.section_draft, '') != '')`

/** Priority and reservations only for the codes in the file (bound as one JSON array). */
export const SECTIONS_PEOPLE_PRIORITY_SQL = `SELECT section_code, town, municipality, oblast, r, level, components
FROM priority_sections WHERE section_code IN (SELECT value FROM json_each(?))`
export const SECTIONS_PEOPLE_TAKEN_SQL = `SELECT section_code, organisation
FROM taken_sections WHERE section_code IN (SELECT value FROM json_each(?))`

export interface SectionsPeopleSignupRow {
  id: string
  first_name: string
  middle_name: string
  last_name: string
  phone: string
  email: string
  role: string
  coordinator: number
  draft_section: string
  published_section: string
  designation_mir: string
  designation_number: number | null
}

export interface SectionsPeoplePartnerRow {
  id: string
  partner: string
  first_name: string
  middle_name: string
  last_name: string
  phone: string
  email: string
  section_draft: string
  section_published: string
  designation_mir: string
  designation_number: number | null
}

export interface SectionsPeoplePriorityRow {
  section_code: string
  town: string
  municipality: string
  oblast: string
  r: number | null
  level: string
  components: string
}

export interface CikSection {
  oblast: string
  municipality: string
  town: string
  address: string
  voters: number | null
}

export interface AbroadPlace {
  country: string
  place: string
  address: string
}

export interface SectionsPeopleSources {
  signups: SectionsPeopleSignupRow[]
  partners: SectionsPeoplePartnerRow[]
  priority: SectionsPeoplePriorityRow[]
  taken: Array<{ section_code: string; organisation: string }>
  cik: (code: string) => CikSection | undefined
  abroad: (code: string) => AbroadPlace | undefined
  abroadMachine: ReadonlySet<string>
  mirNames: Record<string, string>
}

interface Person {
  code: string
  source: 0 | 1
  cells: string[]
}

const text = (value: unknown) => String(value ?? '').trim()
const sectionOf = (value: unknown) => {
  const code = normalizeSection(text(value))
  return /^\d{9}$/.test(code) ? code : ''
}
const fullName = (row: { first_name: string; middle_name: string; last_name: string }) =>
  [row.first_name, row.middle_name, row.last_name].map(text).filter(Boolean).join(' ')
const designation = (mir: string, number: number | null) =>
  number === null || number === undefined || text(number) === '' ? '' : `${text(mir)}/${text(number)}`
const ROLE: Record<string, string> = { section: 'секционен (член СИК/застъпник)', mobile: 'мобилен екип' }

/** Published code first, else the draft; the status says which, and names a different pending draft. */
export function assignedSection(published: unknown, draft: unknown) {
  const pub = sectionOf(published)
  const dft = sectionOf(draft)
  if (pub) return { code: pub, status: dft && dft !== pub ? `публикувана (чернова друга: ${dft})` : 'публикувана' }
  if (dft) return { code: dft, status: 'чернова' }
  return { code: '', status: '' }
}

/** Unpack the CIK fixture: lines „code\ttown\taddress\tvoters“ and „ОБЛАСТ|ОБЩИНА“ per 4-digit prefix. */
export function parseCikSections(packed: string, municipalities: Record<string, string>) {
  const out = new Map<string, CikSection>()
  for (const line of packed.split('\n')) {
    const [code, town = '', address = '', voters = ''] = line.split('\t')
    if (!code) continue
    const [oblast = '', municipality = ''] = (municipalities[code.slice(0, 4)] ?? '').split('|')
    const count = voters === '' ? null : Number(voters)
    out.set(code, { oblast, municipality, town, address, voters: count !== null && Number.isFinite(count) ? count : null })
  }
  return out
}

/** Paper or machine, as in the 23.10 file: CIK voters (machine at ≥300), ПСИК, abroad per CIK р.336, else the priority file. */
export function sectionDeskText(code: string, cik: CikSection | undefined, priority: SectionsPeoplePriorityRow | undefined, abroadMachine: ReadonlySet<string>) {
  if (code.startsWith('32')) return abroadMachine.has(code) ? 'машинна' : 'хартия'
  if (cik && typeof cik.voters === 'number') return cik.voters < PAPER_VOTERS_MAX ? 'хартия' : 'машинна'
  if (/ПОДВИЖНА/i.test(`${cik?.town ?? ''} ${cik?.address ?? ''}`)) return 'хартия'
  if (priority) {
    let mode: unknown
    try {
      mode = (JSON.parse(priority.components || '{}') as { mode?: unknown }).mode
    } catch {
      mode = undefined
    }
    if (mode === 'p') return 'хартия'
    if (mode === 'x') return 'машинна'
  }
  return 'неизвестно'
}

/**
 * One row per assigned person; sections without anyone are left out. Sorted by section code (abroad
 * last), then ours before „И аз“, published before draft, then by name.
 */
export function sectionsPeopleRows(sources: SectionsPeopleSources): string[][] {
  const people: Person[] = []
  for (const row of sources.signups) {
    const { code, status } = assignedSection(row.published_section, row.draft_section)
    if (!code) continue
    const role = (ROLE[text(row.role)] ?? text(row.role)) + (Number(row.coordinator) ? ' · координатор' : '')
    people.push({ code, source: 0, cells: ['Ти броиш', fullName(row), role, text(row.phone), text(row.email), status, designation(row.designation_mir, row.designation_number)] })
  }
  for (const row of sources.partners) {
    const { code, status } = assignedSection(row.section_published, row.section_draft)
    if (!code) continue
    const source = text(row.partner) ? `И аз (${text(row.partner)})` : 'И аз'
    people.push({ code, source: 1, cells: [source, fullName(row), '', text(row.phone), text(row.email), status, designation(row.designation_mir, row.designation_number)] })
  }
  const counts = new Map<string, number>()
  for (const person of people) counts.set(person.code, (counts.get(person.code) ?? 0) + 1)
  const priority = new Map(sources.priority.map((row) => [text(row.section_code), row]))
  const taken = new Map(sources.taken.map((row) => [text(row.section_code), text(row.organisation)]))
  people.sort(
    (a, b) =>
      Number(a.code.startsWith('32')) - Number(b.code.startsWith('32')) ||
      a.code.localeCompare(b.code) ||
      a.source - b.source ||
      Number(!a.cells[5].startsWith('публикувана')) - Number(!b.cells[5].startsWith('публикувана')) ||
      a.cells[1].localeCompare(b.cells[1], 'bg'),
  )
  return people.map((person) => {
    const code = person.code
    const pri = priority.get(code)
    const cik = sources.cik(code)
    const mir = code.slice(0, 2)
    let place: string[]
    if (code.startsWith('32')) {
      const abroad = sources.abroad(code)
      place = [`32 ${sources.mirNames['32'] || 'Извън страната'}`, abroad?.country ?? '', '', (abroad?.place ?? '').replace(/\s*\*+$/, ''), abroad?.address ?? '']
    } else {
      place = [
        `${mir} ${sources.mirNames[mir] ?? ''}`.trim(),
        cik?.oblast || text(pri?.oblast),
        cik?.municipality || text(pri?.municipality),
        cik?.town || text(pri?.town),
        cik?.address ?? '',
      ]
    }
    const priorityText = pri ? `${pri.r === null || pri.r === undefined ? '' : text(pri.r)} / ${priorityLevelLabel(text(pri.level))}` : ''
    return [
      code,
      code.slice(-3),
      ...place,
      sectionDeskText(code, cik, pri, sources.abroadMachine),
      priorityText,
      taken.get(code) ?? '',
      String(counts.get(code) ?? 0),
      ...person.cells,
    ]
  })
}

/** Distinct section codes held by anyone in these rows (for the priority / reservation lookups). */
export function sectionsPeopleCodes(signups: SectionsPeopleSignupRow[], partners: SectionsPeoplePartnerRow[]) {
  const codes = new Set<string>()
  for (const row of signups) {
    const { code } = assignedSection(row.published_section, row.draft_section)
    if (code) codes.add(code)
  }
  for (const row of partners) {
    const { code } = assignedSection(row.section_published, row.section_draft)
    if (code) codes.add(code)
  }
  return [...codes].sort()
}

/** UTF-8 CSV with a BOM (Excel), comma separated. */
export function sectionsPeopleCsv(rows: string[][]) {
  return toCsv([...SECTIONS_PEOPLE_HEADERS], rows)
}

export function sectionsPeopleFilename(now = new Date()) {
  const sofia = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return `tibroish-sekcii-s-hora-${sofia}.csv`
}

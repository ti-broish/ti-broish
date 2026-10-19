// Import of people who signed up with a partner organisation („И аз“, iaz.bg).
// Pure module: no D1, no mail, no Brevo. The admin server function and the one-off
// script both run the same parse → plan → statements path, so a dry run shows exactly
// what a commit writes. Nothing here sends a letter to the imported people.
import { emptyProfile, type HomePlace, type Profile, type TravelStop } from './model'
import { IMPORT_REGIONS, type ImportRegion } from './partner-import-regions.data'
import { signupColumns } from './record'
import { districtKey, sofiaMir, validEgn } from './rules'

export const IAZ_PARTNER = 'iaz.bg'
export const IAZ_LABEL = 'И аз'
export const PARTNER_IMPORT_MAX_ROWS = 2000
export const PARTNER_IMPORT_MAX_BYTES = 1_000_000

const PARTNER_BADGES: Record<string, string> = { [IAZ_PARTNER]: IAZ_LABEL }

/** Badge text for a partner slug or signup source, or '' when it is not a known partner. */
export function partnerBadge(slug: string | null | undefined) {
  return PARTNER_BADGES[(slug ?? '').trim().toLowerCase()] ?? ''
}

/** Rows of the „И аз“ view: imported from the partner file, or arrived on the site with ?source=iaz.bg. */
export const IAZ_VIEW_SQL = "(COALESCE(partner, '') = 'iaz.bg' OR lower(COALESCE(source, '')) = 'iaz.bg') AND COALESCE(withdrawn, 0) = 0"

export const PARTNER_COLUMNS = {
  name: ['име', 'имена', 'name', 'full name'],
  email: ['имейл', 'email', 'e-mail', 'мейл'],
  egn: ['егн', 'egn'],
  phone: ['телефон', 'phone', 'тел'],
  oblast: ['област', 'oblast', 'region'],
  municipalities: ['общини', 'община', 'municipalities', 'municipality'],
  submitted: ['подадено', 'submitted', 'дата'],
} as const

export const PARTNER_MAPPING: ReadonlyArray<{ column: string; field: string }> = [
  { column: 'Име', field: 'Име, презиме, фамилия (първа дума, втора, останалите)' },
  { column: 'Имейл', field: 'Имейл (малки букви, без интервали)' },
  { column: 'ЕГН', field: 'ЕГН (проверка на датата и контролната цифра; изпуснати водещи нули се връщат)' },
  { column: 'Телефон', field: 'Телефон като 08xxxxxxxx (+359/359/без нула се нормализират)' },
  { column: 'Област', field: 'Област / МИР (София град → София-град, Софийска → София област)' },
  { column: 'Общини', field: 'Първата разпозната община е мястото, другите са общини, до които може да пътува; неразпознатото отива в бележката на екипа' },
  { column: 'Подадено', field: 'Час на записване (created_at) и час при партньора (Europe/Sofia → UTC)' },
  { column: 'IP', field: 'Не се пази (приложението не пази IP)' },
]

export interface PartnerRawRow {
  line: number
  name: string
  email: string
  egn: string
  phone: string
  oblast: string
  municipalities: string
  submitted: string
}

export interface PartnerPerson {
  line: number
  firstName: string
  middleName: string
  lastName: string
  email: string
  egn: string
  phone: string
  place: HomePlace | null
  travel: TravelStop[]
  /** Общини values that did not match a municipality of the oblast. */
  unmatched: string[]
  submittedAt: string | null
  warnings: string[]
}

export type MapResult = { ok: true; person: PartnerPerson } | { ok: false; line: number; email: string; reasons: string[] }

export interface ExistingSignup {
  id: string
  email: string
  egn: string | null
  partner: string | null
}

export type PlanKind = 'new' | 'tag' | 'already' | 'repeat' | 'invalid'

export interface PlanRow {
  line: number
  kind: PlanKind
  email: string
  person?: PartnerPerson
  existingId?: string
  reasons: string[]
}

export interface PartnerPlan {
  partner: string
  total: number
  rows: PlanRow[]
  counts: Record<PlanKind, number>
  headerErrors: string[]
}

// ---------- CSV ----------

export function parsePartnerCsv(text: string): { rows: PartnerRawRow[]; errors: string[] } {
  const source = text.replace(/^\uFEFF/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ','
  const table = splitCsv(source, delimiter)
  const header = (table[0] ?? []).map((cell) => cell.trim().toLowerCase())
  const index = (names: readonly string[]) => header.findIndex((cell) => names.includes(cell))
  const columns = {
    name: index(PARTNER_COLUMNS.name),
    email: index(PARTNER_COLUMNS.email),
    egn: index(PARTNER_COLUMNS.egn),
    phone: index(PARTNER_COLUMNS.phone),
    oblast: index(PARTNER_COLUMNS.oblast),
    municipalities: index(PARTNER_COLUMNS.municipalities),
    submitted: index(PARTNER_COLUMNS.submitted),
  }
  const missing = (['name', 'email', 'egn'] as const).filter((key) => columns[key] < 0)
  if (missing.length) {
    return { rows: [], errors: ['Първият ред трябва да е „Име;Имейл;ЕГН;Телефон;Област;Общини;IP;Подадено“.'] }
  }
  const rows: PartnerRawRow[] = []
  table.slice(1).forEach((cells, offset) => {
    if (cells.every((cell) => !cell.trim())) return
    const at = (position: number) => (position >= 0 ? (cells[position] ?? '').trim() : '')
    rows.push({
      line: offset + 2,
      name: at(columns.name),
      email: at(columns.email),
      egn: at(columns.egn),
      phone: at(columns.phone),
      oblast: at(columns.oblast),
      municipalities: at(columns.municipalities),
      submitted: at(columns.submitted),
    })
  })
  return { rows, errors: [] }
}

function splitCsv(text: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"' && cell === '') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

// ---------- field normalisation ----------

function titleWord(word: string) {
  return word
    .split('-')
    .map((part) => {
      if (!part) return part
      const mixed = part !== part.toLocaleLowerCase('bg-BG') && part !== part.toLocaleUpperCase('bg-BG')
      if (mixed) return part
      const lower = part.toLocaleLowerCase('bg-BG')
      return lower.charAt(0).toLocaleUpperCase('bg-BG') + lower.slice(1)
    })
    .join('-')
}

/** One „Име“ field → first, middle, last. Two words have no middle name; four or more keep the rest as the family name. */
export function splitFullName(value: string) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).map(titleWord)
  if (words.length === 0) return { firstName: '', middleName: '', lastName: '' }
  if (words.length === 1) return { firstName: words[0]!, middleName: '', lastName: '' }
  if (words.length === 2) return { firstName: words[0]!, middleName: '', lastName: words[1]! }
  return { firstName: words[0]!, middleName: words[1]!, lastName: words.slice(2).join(' ') }
}

export function normalizeEmail(value: string) {
  return value.replace(/\s+/g, '').toLowerCase()
}

export function emailProblem(email: string) {
  if (!email) return 'липсва имейл'
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) || /\.\./.test(email) || !/\.[a-z]{2,}$/i.test(email)) return 'имейлът не е валиден'
  return null
}

/** Spreadsheets drop the leading zeros of ЕГН born 2000–2009. Pad only when the padded value is a real ЕГН. */
export function normalizeEgn(value: string): { egn: string; padded: boolean; problem: string | null } {
  const digits = value.replace(/\D/g, '')
  if (!digits) return { egn: '', padded: false, problem: 'липсва ЕГН' }
  if (/[^\d\s]/.test(value.trim())) return { egn: '', padded: false, problem: 'ЕГН не е само цифри' }
  if (digits.length > 10) return { egn: '', padded: false, problem: 'ЕГН е по-дълго от 10 цифри' }
  const egn = digits.padStart(10, '0')
  if (!validEgn(egn)) return { egn: '', padded: false, problem: 'ЕГН не е валидно (дата или контролна цифра)' }
  return { egn, padded: egn !== digits, problem: null }
}

/** Bulgarian phone as 0XXXXXXXXX, the way the signup form asks for it. */
export function normalizePhone(value: string): { phone: string; problem: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { phone: '', problem: null }
  let digits = trimmed.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('359') && digits.length >= 11) digits = `0${digits.slice(3)}`
  else if (/^[2-9]\d{7,8}$/.test(digits)) digits = `0${digits}`
  if (!/^0[2-9]\d{7,8}$/.test(digits)) return { phone: '', problem: 'телефонът не е валиден' }
  return { phone: digits, problem: null }
}

const MONTHS: Record<string, number> = {
  яну: 1, фев: 2, мар: 3, апр: 4, май: 5, юни: 6, юли: 7, авг: 8, сеп: 9, окт: 10, ное: 11, дек: 12,
}

function sofiaOffsetMinutes(utcMillis: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Sofia',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utcMillis))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((local - utcMillis) / 60_000)
}

/** „19 окт 2026 · 7:21“ in Sofia time → ISO UTC. Also takes an ISO timestamp. */
export function parseSubmitted(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const match = text.match(/^(\d{1,2})[\s.]+(\p{L}+)\.?\s+(\d{4})(?:\s*[·,-]?\s*(\d{1,2}):(\d{2}))?/u)
  if (!match) return null
  const month = MONTHS[match[2]!.toLocaleLowerCase('bg-BG').slice(0, 3)]
  if (!month) return null
  const [day, year, hour, minute] = [Number(match[1]), Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0)]
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  let utc = guess - sofiaOffsetMinutes(guess) * 60_000
  utc = guess - sofiaOffsetMinutes(utc) * 60_000
  return new Date(utc).toISOString()
}

// ---------- place ----------

const LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
}

/** Compare key: lower case, Latin letters, no punctuation („Sofiya“, „Sofia“ and „София“ meet). */
export function placeKey(value: string) {
  const lower = value.toLocaleLowerCase('bg-BG').replace(/^(гр|с|общ|община|град|село|обл|област)\.?\s+/u, '')
  const latin = [...lower].map((char) => LATIN[char] ?? char).join('')
  return latin.replace(/[^a-z0-9]/g, '').replace(/iya$/, 'ia').replace(/y/g, 'i')
}

const OBLAST_ALIASES: Record<string, string> = {
  [placeKey('София град')]: 'sofia-merged',
  [placeKey('София-град')]: 'sofia-merged',
  [placeKey('Столица')]: 'sofia-merged',
  [placeKey('Sofia city')]: 'sofia-merged',
  [placeKey('Софийска')]: '26',
  [placeKey('София област')]: '26',
  [placeKey('Пловдив')]: 'plovdiv',
  [placeKey('Пловдив град')]: '16',
  [placeKey('Пловдив област')]: '17',
}

const MUNICIPALITY_ALIASES: Record<string, string> = {
  [placeKey('София')]: 'Столична',
  [placeKey('Sofia')]: 'Столична',
  [placeKey('Sofiya')]: 'Столична',
}

function regionsFor(oblast: string, regions: ReadonlyArray<ImportRegion>): ImportRegion[] {
  const key = placeKey(oblast)
  if (!key) return []
  const alias = OBLAST_ALIASES[key]
  if (alias === 'plovdiv') return regions.filter((region) => region.code === '16' || region.code === '17')
  if (alias) return regions.filter((region) => region.code === alias)
  return regions.filter((region) => placeKey(region.name) === key)
}

function municipalityIn(region: ImportRegion, value: string) {
  const key = placeKey(value)
  const alias = MUNICIPALITY_ALIASES[key]
  const target = alias ? placeKey(alias) : key
  const found = region.municipalities.find(([, name]) => placeKey(name) === target)
  return found ? { code: found[0], name: found[1] } : null
}

export function mapPlace(oblast: string, municipalities: string, regions: ReadonlyArray<ImportRegion> = IMPORT_REGIONS) {
  const candidates = regionsFor(oblast, regions)
  const values = municipalities
    .split(/[,;/\n]+/)
    .map((value) => value.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const matched: Array<{ region: ImportRegion; code: string; name: string }> = []
  const unmatched: string[] = []
  let cityRegionName = ''
  for (const value of values) {
    let hit: { region: ImportRegion; code: string; name: string } | null = null
    for (const region of candidates) {
      const municipality = municipalityIn(region, value)
      if (municipality) {
        hit = { region, ...municipality }
        break
      }
    }
    if (hit) {
      const id = `${hit.region.code}:${hit.code}`
      if (!seen.has(id)) {
        seen.add(id)
        matched.push(hit)
      }
      continue
    }
    const district = value.replace(/\d+/g, '').trim()
    if (candidates.some((region) => region.code === 'sofia-merged') && sofiaMir(district)) {
      cityRegionName = cityRegionName || titleWord(districtKey(district))
      if (!seen.has('sofia-merged:46')) {
        seen.add('sofia-merged:46')
        matched.push({ region: candidates.find((region) => region.code === 'sofia-merged')!, code: '46', name: 'Столична' })
      }
      continue
    }
    unmatched.push(value)
  }
  // Пловдив without a municipality: the oblast, not the city.
  const region = matched[0]?.region ?? (candidates.length === 1 ? candidates[0] : candidates.find((item) => item.code === '17'))
  if (!region) return { place: null, travel: [] as TravelStop[], unmatched, oblastKnown: false }
  const home = matched[0]
  // A one-municipality oblast (София-град) has its municipality even when Общини is empty or free text.
  const only = !home && region.municipalities.length === 1 ? { code: region.municipalities[0]![0], name: region.municipalities[0]![1] } : null
  const place: HomePlace = {
    regionCode: region.code,
    regionName: region.name,
    ...(home ? { municipalityCode: home.code, municipalityName: home.name } : only ? { municipalityCode: only.code, municipalityName: only.name } : {}),
    ...(cityRegionName ? { cityRegionName } : {}),
  }
  const travel: TravelStop[] = matched.slice(1).map((item) => ({ regionCode: item.region.code, regionName: item.region.name, code: item.code, name: item.name }))
  return { place, travel, unmatched, oblastKnown: true }
}

// ---------- row mapping ----------

export function mapPartnerRow(raw: PartnerRawRow, regions: ReadonlyArray<ImportRegion> = IMPORT_REGIONS): MapResult {
  const reasons: string[] = []
  const warnings: string[] = []
  const names = splitFullName(raw.name)
  if (!names.firstName) reasons.push('липсва име')
  else if (!names.lastName) warnings.push('само едно име')
  const email = normalizeEmail(raw.email)
  const emailIssue = emailProblem(email)
  if (emailIssue) reasons.push(emailIssue)
  const egn = normalizeEgn(raw.egn)
  if (egn.problem) reasons.push(egn.problem)
  else if (egn.padded) warnings.push('ЕГН с върнати водещи нули')
  const phone = normalizePhone(raw.phone)
  if (phone.problem) reasons.push(phone.problem)
  else if (!phone.phone) warnings.push('няма телефон')
  const place = mapPlace(raw.oblast, raw.municipalities, regions)
  if (raw.oblast && !place.oblastKnown) warnings.push('непозната област')
  if (place.unmatched.length) warnings.push('част от общините не са разпознати')
  const submittedAt = parseSubmitted(raw.submitted)
  if (raw.submitted && !submittedAt) warnings.push('часът „Подадено“ не се разчита')
  if (reasons.length) return { ok: false, line: raw.line, email, reasons }
  return {
    ok: true,
    person: {
      line: raw.line,
      ...names,
      email,
      egn: egn.egn,
      phone: phone.phone,
      place: place.place,
      travel: place.travel,
      unmatched: place.unmatched,
      submittedAt,
      warnings,
    },
  }
}

// ---------- plan ----------

function later(a: PartnerPerson, b: PartnerPerson) {
  const at = a.submittedAt ?? ''
  const bt = b.submittedAt ?? ''
  if (at !== bt) return at > bt ? a : b
  return a.line > b.line ? a : b
}

/**
 * Classifies every row. `existing` are signups that share an email or ЕГН with the file.
 * new: insert. tag: an existing signup gets only the partner tag. already: tagged before (re-import).
 * repeat: the same person again in the file (the latest submission wins). invalid: skipped, with reasons.
 */
export function planPartnerImport(rawRows: PartnerRawRow[], existing: ExistingSignup[], partner = IAZ_PARTNER): PartnerPlan {
  const rows: PlanRow[] = []
  const valid: PartnerPerson[] = []
  for (const raw of rawRows) {
    const mapped = mapPartnerRow(raw)
    if (mapped.ok) valid.push(mapped.person)
    else rows.push({ line: mapped.line, kind: 'invalid', email: mapped.email, reasons: mapped.reasons })
  }
  // One email used for different ЕГН is several people on one address: the app keeps one signup per email.
  const byEmail = new Map<string, PartnerPerson[]>()
  for (const person of valid) byEmail.set(person.email, [...(byEmail.get(person.email) ?? []), person])
  const byEgn = new Map<string, Set<string>>()
  for (const person of valid) byEgn.set(person.egn, new Set([...(byEgn.get(person.egn) ?? []), person.email]))
  const keep: PartnerPerson[] = []
  for (const [email, group] of byEmail) {
    const egns = new Set(group.map((person) => person.egn))
    if (egns.size > 1) {
      for (const person of group) {
        rows.push({ line: person.line, kind: 'invalid', email, reasons: [`един имейл за ${egns.size} различни ЕГН във файла`] })
      }
      continue
    }
    const egnEmails = byEgn.get(group[0]!.egn)
    if (egnEmails && egnEmails.size > 1) {
      for (const person of group) {
        rows.push({ line: person.line, kind: 'invalid', email, reasons: ['едно ЕГН с различни имейли във файла'] })
      }
      continue
    }
    const latest = group.reduce(later)
    for (const person of group) {
      if (person !== latest) rows.push({ line: person.line, kind: 'repeat', email, reasons: [`същият човек отново, взет е ред ${latest.line}`] })
    }
    keep.push(latest)
  }
  const existingByEmail = new Map(existing.map((row) => [row.email.trim().toLowerCase(), row]))
  const existingByEgn = new Map<string, ExistingSignup>()
  for (const row of existing) if (row.egn) existingByEgn.set(row.egn.replace(/\D/g, ''), row)
  for (const person of keep) {
    const emailHit = existingByEmail.get(person.email)
    const egnHit = existingByEgn.get(person.egn)
    if (emailHit && egnHit && emailHit.id !== egnHit.id) {
      rows.push({ line: person.line, kind: 'invalid', email: person.email, person, reasons: ['имейлът и ЕГН са на две различни записвания'] })
      continue
    }
    if (emailHit && emailHit.egn && emailHit.egn !== person.egn) {
      rows.push({ line: person.line, kind: 'invalid', email: person.email, person, reasons: ['имейлът вече е записан с друго ЕГН'] })
      continue
    }
    const hit = emailHit ?? egnHit
    if (!hit) {
      rows.push({ line: person.line, kind: 'new', email: person.email, person, reasons: [] })
      continue
    }
    const tagged = (hit.partner ?? '').trim().toLowerCase() === partner
    rows.push({
      line: person.line,
      kind: tagged ? 'already' : 'tag',
      email: person.email,
      person,
      existingId: hit.id,
      reasons: [tagged ? `вече е с „${partnerBadge(partner) || partner}“` : emailHit ? 'има записване с този имейл' : 'има записване с това ЕГН'],
    })
  }
  rows.sort((a, b) => a.line - b.line)
  const counts: Record<PlanKind, number> = { new: 0, tag: 0, already: 0, repeat: 0, invalid: 0 }
  for (const row of rows) counts[row.kind] += 1
  return { partner, total: rawRows.length, rows, counts, headerErrors: [] }
}

/** Emails and ЕГН to look up before planning. */
export function lookupKeys(rawRows: PartnerRawRow[]) {
  const emails = new Set<string>()
  const egns = new Set<string>()
  for (const raw of rawRows) {
    const email = normalizeEmail(raw.email)
    if (email) emails.add(email)
    const egn = normalizeEgn(raw.egn)
    if (egn.egn) egns.add(egn.egn)
  }
  return { emails: [...emails], egns: [...egns] }
}

export const EXISTING_SIGNUPS_SQL = (emailCount: number, egnCount: number) => {
  const parts: string[] = []
  if (emailCount) parts.push(`lower(email) IN (${Array(emailCount).fill('?').join(', ')})`)
  if (egnCount) parts.push(`REPLACE(COALESCE(egn, ''), ' ', '') IN (${Array(egnCount).fill('?').join(', ')})`)
  return `SELECT id, lower(email) AS email, egn, partner FROM signups WHERE ${parts.join(' OR ') || '1 = 0'}`
}

// ---------- statements ----------

export interface SqlStatement {
  sql: string
  params: Array<string | number | null>
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export interface StatementIds {
  id: () => string
  token: () => string
  referral: () => string
}

export const randomIds: StatementIds = {
  id: () => crypto.randomUUID(),
  token: () => crypto.randomUUID(),
  referral: () => [...crypto.getRandomValues(new Uint8Array(6))].map((byte) => ALPHABET[byte % ALPHABET.length]).join(''),
}

export function partnerProfile(person: PartnerPerson, partner: string, referralCode: string): Profile {
  return {
    ...emptyProfile(),
    firstName: person.firstName,
    middleName: person.middleName,
    lastName: person.lastName,
    email: person.email,
    phone: person.phone,
    egn: person.egn,
    place: person.place,
    travelMunicipalities: person.travel,
    referralCode,
    source: partner,
  }
}

function staffNoteOf(person: PartnerPerson) {
  if (!person.unmatched.length) return null
  return `${IAZ_LABEL}, общини: ${person.unmatched.join(', ')}`.slice(0, 400)
}

export const INSERT_PARTNER_SQL = `INSERT INTO signups (
  id, email, session_token, referral_code, source, partner, partner_submitted_at, partner_imported_at, egn,
  rounds_first, rounds_runoff, region_code, mir_code, municipality_name, town_name, city_region_name,
  travel_municipalities, payload, email_confirmed, consent, submitted, withdrawn, imported, signup_mail_at,
  staff_note, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 1, 'skipped', ?, ?, ?)
ON CONFLICT(email) DO NOTHING`

/** Only the tag: never touches the person's own fields, and never re-tags. */
export const TAG_PARTNER_SQL = `UPDATE signups SET partner = ?, partner_submitted_at = COALESCE(partner_submitted_at, ?), partner_imported_at = COALESCE(partner_imported_at, ?)
WHERE id = ? AND COALESCE(partner, '') = ''`

/**
 * New people are imported, not confirmed: email_confirmed 0, no confirm_token, so no letter goes out
 * and „Изпрати чакащите писма“ skips them. signup_mail_at = skipped keeps the receipt letter off.
 * They can still sign in with a code on their address and take the signup over.
 */
export function partnerImportStatements(plan: PartnerPlan, now: string, ids: StatementIds = randomIds): SqlStatement[] {
  const statements: SqlStatement[] = []
  for (const row of plan.rows) {
    if (row.kind === 'new' && row.person) {
      const person = row.person
      const referral = ids.referral()
      const columns = signupColumns(partnerProfile(person, plan.partner, referral))
      statements.push({
        sql: INSERT_PARTNER_SQL,
        params: [
          ids.id(),
          columns.email,
          ids.token(),
          referral,
          plan.partner,
          plan.partner,
          person.submittedAt,
          now,
          columns.egn,
          columns.roundsFirst,
          columns.roundsRunoff,
          columns.regionCode,
          columns.mirCode,
          columns.municipalityName,
          columns.townName,
          columns.cityRegionName,
          columns.travelMunicipalities,
          columns.payload,
          staffNoteOf(person),
          person.submittedAt ?? now,
          now,
        ],
      })
    }
    if (row.kind === 'tag' && row.existingId) {
      statements.push({ sql: TAG_PARTNER_SQL, params: [plan.partner, row.person?.submittedAt ?? null, now, row.existingId] })
    }
  }
  return statements
}

/** SQL text with literals, for `wrangler d1 execute --file` in the one-off script. */
export function inlineSql(statement: SqlStatement) {
  let index = 0
  const text = statement.sql.replace(/\?/g, () => {
    const value = statement.params[index]
    index += 1
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
    return `'${String(value).replace(/'/g, "''")}'`
  })
  if (index !== statement.params.length) throw new Error('Броят на параметрите не съвпада.')
  return `${text};`
}

// ---------- preview ----------

export function maskEgn(egn: string) {
  return egn ? `******${egn.slice(-4)}` : ''
}

export function maskEmail(email: string) {
  const [user = '', domain = ''] = email.split('@')
  return `${user.slice(0, 1)}***@${domain}`
}

export interface PreviewRow {
  line: number
  kind: PlanKind
  name: string
  email: string
  egn: string
  phone: string
  place: string
  submittedAt: string
  reasons: string[]
  warnings: string[]
}

export function previewRows(plan: PartnerPlan, limit = 500): PreviewRow[] {
  return plan.rows.slice(0, limit).map((row) => ({
    line: row.line,
    kind: row.kind,
    name: row.person ? [row.person.firstName, row.person.middleName, row.person.lastName].filter(Boolean).join(' ') : '',
    email: row.email,
    egn: maskEgn(row.person?.egn ?? ''),
    phone: row.person?.phone ?? '',
    place: row.person?.place
      ? [row.person.place.regionName, row.person.place.municipalityName, row.person.place.cityRegionName, ...row.person.travel.map((stop) => `+ ${stop.name}`)]
          .filter(Boolean)
          .join(', ')
      : '',
    submittedAt: row.person?.submittedAt ?? '',
    reasons: row.reasons,
    warnings: row.person?.warnings ?? [],
  }))
}

export function planSummary(plan: PartnerPlan) {
  const { counts } = plan
  return `Редове ${plan.total}: нови ${counts.new}, вече записани (само етикет) ${counts.tag}, вече внесени ${counts.already}, повторени във файла ${counts.repeat}, невалидни ${counts.invalid}.`
}

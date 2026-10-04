import { validEgn } from './rules'

export const SIGNUP_VIEWS = ['all', 'finished', 'started', 'assigned', 'unassigned', 'abroad', 'calls', 'queue', 'mir', 'draft'] as const
export const SIGNUP_SORTS = ['updated', 'name', 'email', 'phone', 'mir', 'role'] as const
export const SECTION_VIEWS = ['unassigned', 'draft', 'assigned', 'abroad', 'mir'] as const

export type SignupSearch = {
  q: string
  view: (typeof SIGNUP_VIEWS)[number]
  mir: string
  page: number
  sort: (typeof SIGNUP_SORTS)[number]
  dir: 'asc' | 'desc'
}

export type SectionSearch = {
  q: string
  view: (typeof SECTION_VIEWS)[number]
  mir: string
}

export const defaultSignupSearch: SignupSearch = {
  q: '',
  view: 'all',
  mir: '',
  page: 1,
  sort: 'updated',
  dir: 'desc',
}

export const defaultSectionSearch: SectionSearch = {
  q: '',
  view: 'unassigned',
  mir: '',
}

export const QUEUE_SHOWS = ['open', 'all'] as const
export const QUEUE_SORTS = ['flagged', 'days', 'name'] as const

export type QueueSearch = {
  q: string
  page: number
  show: (typeof QUEUE_SHOWS)[number]
  sort: (typeof QUEUE_SORTS)[number]
  dir: 'asc' | 'desc'
}

export const defaultQueueSearch: QueueSearch = {
  q: '',
  page: 1,
  show: 'open',
  sort: 'flagged',
  dir: 'desc',
}

export type AdminSearchKind = 'empty' | 'egn' | 'email' | 'phone' | 'name' | 'text'

export interface ClassifiedSearch {
  kind: AdminSearchKind
  raw: string
  egn?: string
  egnValid?: boolean
  email?: string
  emailExact?: boolean
  phoneExact?: string[]
  phoneLast9?: string
  tokens?: string[]
  fts?: string
}

export const PHONE_DIGITS_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(json_extract(payload, '$.phone'), ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', '')"

const NAME_FIELDS = [
  "COALESCE(json_extract(payload, '$.firstName'), '')",
  "COALESCE(json_extract(payload, '$.middleName'), '')",
  "COALESCE(json_extract(payload, '$.lastName'), '')",
] as const

const TEXT_FIELDS = [
  'email',
  "COALESCE(json_extract(payload, '$.firstName'), '')",
  "COALESCE(json_extract(payload, '$.middleName'), '')",
  "COALESCE(json_extract(payload, '$.lastName'), '')",
  "COALESCE(json_extract(payload, '$.phone'), '')",
  "COALESCE(egn, '')",
  "COALESCE(town_name, '')",
  "COALESCE(section_place, '')",
  "COALESCE(municipality_name, '')",
  "COALESCE(city_region_name, '')",
  "COALESCE(draft_section, '')",
  "COALESCE(published_section, '')",
  "COALESCE(mir_code, '')",
] as const

export function parseSignupSearch(search: Record<string, unknown>): SignupSearch {
  const view = typeof search.view === 'string' && isOneOf(search.view, SIGNUP_VIEWS) ? search.view : 'all'
  const sort = typeof search.sort === 'string' && isOneOf(search.sort, SIGNUP_SORTS) ? search.sort : 'updated'
  return {
    q: clipText(search.q),
    view,
    mir: clipText(search.mir, 8),
    page: clampPage(search.page),
    sort,
    dir: search.dir === 'asc' ? 'asc' : 'desc',
  }
}

export function parseSectionSearch(search: Record<string, unknown>): SectionSearch {
  const view = typeof search.view === 'string' && isOneOf(search.view, SECTION_VIEWS) ? search.view : 'unassigned'
  return { q: clipText(search.q), view, mir: clipText(search.mir, 8) }
}

export function parseQueueSearch(search: Record<string, unknown>): QueueSearch {
  const show = typeof search.show === 'string' && isOneOf(search.show, QUEUE_SHOWS) ? search.show : 'open'
  const sort = typeof search.sort === 'string' && isOneOf(search.sort, QUEUE_SORTS) ? search.sort : 'flagged'
  return {
    q: clipText(search.q),
    page: clampPage(search.page),
    show,
    sort,
    dir: search.dir === 'asc' ? 'asc' : 'desc',
  }
}

export function clampPage(value: unknown) {
  const page = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(page) || page < 1) return 1
  return Math.min(500, Math.floor(page))
}

export function clampLimit(value: unknown) {
  const limit = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(limit) || limit < 1) return 50
  return Math.min(100, Math.floor(limit))
}

export function rosterOrder(sort: string, dir: string) {
  const direction = dir === 'asc' ? 'ASC' : 'DESC'
  if (sort === 'name') {
    return `json_extract(payload, '$.lastName') ${direction}, json_extract(payload, '$.firstName') ${direction}`
  }
  if (sort === 'flagged') return `COALESCE(json_extract(payload, '$.callRequestedAt'), '') ${direction}`
  if (sort === 'days') {
    const first = `CASE WHEN rounds_first = 1 OR json_extract(payload, '$.rounds.first') = 1 THEN 1 ELSE 0 END`
    const runoff = `CASE WHEN rounds_runoff = 1 OR json_extract(payload, '$.rounds.runoff') = 1 THEN 1 ELSE 0 END`
    if (direction === 'DESC') return `CASE WHEN ${first} = 1 THEN 0 WHEN ${runoff} = 1 THEN 1 ELSE 2 END ASC, ${first} DESC, ${runoff} DESC`
    return `CASE WHEN ${first} = 1 THEN 2 WHEN ${runoff} = 1 THEN 1 ELSE 0 END ASC, ${first} ASC, ${runoff} ASC`
  }
  const columns: Record<string, string> = {
    email: 'email',
    phone: "json_extract(payload, '$.phone')",
    mir: 'mir_code',
    role: 'role',
    updated: 'updated_at',
  }
  return `${columns[sort] ?? 'updated_at'} ${direction}`
}

export function classifyAdminSearch(query: string): ClassifiedSearch {
  const raw = query.trim().replace(/\s+/g, ' ').slice(0, 120)
  if (!raw) return { kind: 'empty', raw: '' }
  if (raw.includes('@')) {
    const email = raw.toLowerCase()
    const exact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    return { kind: 'email', raw, email, emailExact: exact, fts: escapeFtsQuery(raw) }
  }
  const digits = digitQuery(raw)
  if (digits && isBgPhoneDigits(digits)) {
    const phone = phoneMatchKeys(digits)
    return { kind: 'phone', raw, phoneExact: phone.exact, phoneLast9: phone.last9, fts: escapeFtsQuery(raw) }
  }
  if (digits && /^\d{10}$/.test(digits)) {
    return { kind: 'egn', raw, egn: digits, egnValid: validEgn(digits), fts: escapeFtsQuery(digits) }
  }
  const tokens = nameTokens(raw)
  if (tokens) return { kind: 'name', raw, tokens, fts: escapeFtsQuery(tokens.join(' ')) }
  return { kind: 'text', raw, fts: escapeFtsQuery(raw) }
}

export function escapeFtsQuery(value: string) {
  const cleaned = value.replace(/["()* ^:{}]/g, ' ')
  return cleaned
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => `"${token}"*`)
    .join(' ')
}

export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

export function searchClause(query: string, mode: 'fts' | 'like' = 'fts'): { clause: string; binds: string[] } {
  const classified = classifyAdminSearch(query)
  if (classified.kind === 'empty') return { clause: '1 = 1', binds: [] }
  if (classified.kind === 'egn') return { clause: "REPLACE(COALESCE(egn, ''), ' ', '') = ?", binds: [classified.egn ?? ''] }
  if (classified.kind === 'email') {
    const email = classified.email ?? ''
    if (classified.emailExact) return { clause: 'lower(email) = ?', binds: [email] }
    return { clause: "lower(email) LIKE ? ESCAPE '\\'", binds: [`${escapeLike(email)}%`] }
  }
  if (classified.kind === 'phone') {
    const exact = classified.phoneExact ?? []
    const parts = exact.map(() => `${PHONE_DIGITS_SQL} = ?`)
    const binds = [...exact]
    if (classified.phoneLast9) {
      parts.push(`${PHONE_DIGITS_SQL} LIKE ? ESCAPE '\\'`)
      binds.push(`%${classified.phoneLast9}`)
    }
    if (parts.length === 0) return { clause: '1 = 0', binds: [] }
    return { clause: `(${parts.join(' OR ')})`, binds }
  }
  if (classified.kind === 'name') return nameClause(classified.tokens ?? [], mode)
  return textClause(classified, mode)
}

export function normalizePhoneDigits(value: string) {
  let digits = value.replace(/\D/g, '')
  // 00359… is an international prefix. A 10-digit value starting with 00 is an EGN year, not a phone.
  if (digits.startsWith('00') && digits.length > 10) digits = digits.slice(2)
  return digits
}

function digitQuery(value: string) {
  if (/[^\d\s().+\-/]/.test(value)) return null
  const digits = normalizePhoneDigits(value)
  return digits || null
}

function isBgPhoneDigits(digits: string) {
  // A valid EGN can start with 0 (birth year 2000–2009). Those stay exact EGN lookups.
  if (/^\d{10}$/.test(digits) && validEgn(digits)) return false
  if (/^359\d{9}$/.test(digits)) return true
  if (/^[89]\d{8}$/.test(digits)) return true
  return /^0[2-9]\d{8}$/.test(digits)
}

function phoneMatchKeys(digits: string) {
  let national = digits
  if (national.startsWith('359') && national.length >= 12) national = `0${national.slice(3)}`
  if (/^[89]\d{8}$/.test(national)) national = `0${national}`
  const last9 = national.replace(/^0/, '').slice(-9)
  const exact = new Set<string>()
  if (national) exact.add(national)
  if (last9.length === 9) {
    exact.add(last9)
    exact.add(`359${last9}`)
    exact.add(`0${last9}`)
  }
  return { exact: [...exact], last9: last9.length === 9 ? last9 : '' }
}

function nameTokens(value: string) {
  const parts = value.split(' ')
  if (parts.length < 1 || parts.length > 3) return null
  if (!parts.every((part) => /^[\p{L}][\p{L}'’-]{1,39}$/u.test(part))) return null
  return parts
}

function nameVariants(token: string) {
  const lower = token.toLocaleLowerCase('bg-BG')
  const upper = token.toLocaleUpperCase('bg-BG')
  const title = lower ? `${lower[0]!.toLocaleUpperCase('bg-BG')}${lower.slice(1)}` : token
  return [...new Set([token, lower, upper, title])]
}

function nameClause(tokens: string[], mode: 'fts' | 'like') {
  const exact = tokens.map(exactTokenClause)
  const exactSql = exact.map((part) => part.sql).join(' AND ')
  const exactBinds = exact.flatMap((part) => part.binds)
  if (mode === 'fts') {
    const match = escapeFtsQuery(tokens.join(' '))
    if (!match) return { clause: `(${exactSql})`, binds: exactBinds }
    return {
      clause: `((${exactSql}) OR id IN (SELECT signup_id FROM signup_fts WHERE signup_fts MATCH ?))`,
      binds: [...exactBinds, match],
    }
  }
  const like = tokens.map(likeTokenClause)
  return {
    clause: `((${exactSql}) OR (${like.map((part) => part.sql).join(' AND ')}))`,
    binds: [...exactBinds, ...like.flatMap((part) => part.binds)],
  }
}

function exactTokenClause(token: string) {
  const variants = nameVariants(token)
  const parts: string[] = []
  const binds: string[] = []
  for (const field of NAME_FIELDS) {
    for (const variant of variants) {
      parts.push(`${field} = ?`)
      binds.push(variant)
    }
  }
  return { sql: `(${parts.join(' OR ')})`, binds }
}

function likeTokenClause(token: string) {
  const like = `%${escapeLike(token)}%`
  const parts = NAME_FIELDS.map((field) => `${field} LIKE ? ESCAPE '\\'`)
  return { sql: `(${parts.join(' OR ')})`, binds: NAME_FIELDS.map(() => like) }
}

function textClause(classified: ClassifiedSearch, mode: 'fts' | 'like') {
  if (mode === 'fts') {
    const match = classified.fts || escapeFtsQuery(classified.raw)
    if (!match) return { clause: '1 = 0', binds: [] }
    return { clause: 'id IN (SELECT signup_id FROM signup_fts WHERE signup_fts MATCH ?)', binds: [match] }
  }
  const like = `%${escapeLike(classified.raw)}%`
  const parts = TEXT_FIELDS.map((field) => `${field} LIKE ? ESCAPE '\\'`)
  return { clause: `(${parts.join(' OR ')})`, binds: TEXT_FIELDS.map(() => like) }
}

function clipText(value: unknown, max = 120) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function isOneOf<T extends string>(value: string, options: readonly T[]): value is T {
  return (options as readonly string[]).includes(value)
}

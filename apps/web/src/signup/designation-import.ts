import { toCsv } from './admin-csv'
import { updateBrevoContactAttribute } from './designation-brevo'
import { hasRealEmail } from './no-email'
import type { DesignationConfig } from './designation-config'
import { parseStoredNumber } from './designation-number'
import { sqlBatches } from './designation-sql'

export const MANIFEST_COLUMNS = [
  'personId',
  'email',
  'name',
  'number',
  'issuedAt',
  'section',
  'fileName',
  'driveUrl',
  'driveFileId',
] as const

export const IMPORT_LOOKUP_BATCH = 80
export const IMPORT_SAVE_BATCH = 40

export interface ManifestRow {
  personId: string
  email: string
  name: string
  number: string
  issuedAt: string
  section: string
  fileName: string
  driveUrl: string
  driveFileId: string
}

export interface ParsedImportRow {
  rowNumber: number
  personId: string
  email: string
  driveUrl: string
  driveFileId: string
}

export interface ParsedImportIssue {
  rowNumber: number
  kind: 'no-link' | 'invalid'
  reason: string
}

export interface ParsedImport {
  rows: ParsedImportRow[]
  issues: ParsedImportIssue[]
  total: number
}

export interface DesignationImportPerson {
  id: string
  email: string
  publishedSection: string
}

export interface DesignationImportDataSource {
  findPeople(keys: { ids: string[]; emails: string[] }): Promise<DesignationImportPerson[]>
  saveLinks(rows: Array<{ id: string; pdfUrl: string; driveFileId: string | null }>): Promise<void>
}

export interface DesignationImportOptions {
  dryRun: boolean
  skipBrevo: boolean
}

export interface DesignationImportDeps {
  data: DesignationImportDataSource
  parsed: ParsedImport
  config: DesignationConfig
  brevoApiKey?: string
  fetchImpl?: typeof fetch
  log?: (line: string) => void
}

export interface DesignationImportDetail {
  rowNumber: number
  reason: string
}

export interface DesignationImportSummary {
  rows: number
  updated: number
  brevoSynced: number
  noLink: number
  notFound: number
  unpublished: number
  invalid: number
  details: DesignationImportDetail[]
  errors: string[]
}

const PERSON_ID_KEYS = ['personid', 'person_id', 'id']
const EMAIL_KEYS = ['email']
const DRIVE_URL_KEYS = ['driveurl', 'drive_url', 'url']
const DRIVE_FILE_ID_KEYS = ['drivefileid', 'drive_file_id', 'fileid', 'file_id']

export function sortManifest(rows: ManifestRow[]): ManifestRow[] {
  return [...rows].sort((a, b) => {
    const left = parseStoredNumber(a.number) ?? Number.POSITIVE_INFINITY
    const right = parseStoredNumber(b.number) ?? Number.POSITIVE_INFINITY
    if (left !== right) return left - right
    return a.personId.localeCompare(b.personId)
  })
}

export function serializeManifestCsv(rows: ManifestRow[]): string {
  return toCsv(
    [...MANIFEST_COLUMNS],
    rows.map((row) => MANIFEST_COLUMNS.map((column) => row[column])),
  )
}

export function serializeManifestJson(rows: ManifestRow[]): string {
  return `${JSON.stringify(rows, null, 2)}\n`
}

export function importKind(filename: string, text: string): 'csv' | 'json' {
  if (/\.json$/i.test(filename)) return 'json'
  if (/\.csv$/i.test(filename)) return 'csv'
  const trimmed = text.replace(/^\uFEFF/, '').trimStart()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json'
  return 'csv'
}

export function parseImportSource(text: string, filename = ''): ParsedImport {
  const kind = importKind(filename, text)
  if (kind === 'json') return parseImportJson(text)
  return parseImportCsv(text)
}

export function parseImportCsv(text: string): ParsedImport {
  const grid = parseCsv(text)
  if (grid.length === 0) return { rows: [], issues: [], total: 0 }
  const headers = grid[0] ?? []
  const records = grid.slice(1).map((cells, index) => {
    const record: Record<string, string> = {}
    headers.forEach((header, column) => {
      record[header] = cells[column] ?? ''
    })
    return classifyRecord(record, index + 2)
  })
  return collectParsed(records)
}

export function parseImportJson(text: string): ParsedImport {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('JSON файлът не е валиден.')
  }
  const items = jsonRows(parsed)
  const records = items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        kind: 'issue' as const,
        issue: { rowNumber: index + 1, kind: 'invalid' as const, reason: 'редът трябва да е обект' },
      }
    }
    const record: Record<string, string> = {}
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      record[key] = value == null ? '' : String(value)
    }
    return classifyRecord(record, index + 1)
  })
  return collectParsed(records)
}

function jsonRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && 'rows' in value && Array.isArray((value as { rows: unknown }).rows)) {
    return (value as { rows: unknown[] }).rows
  }
  throw new Error('JSON трябва да е масив или { "rows": [...] }.')
}

function collectParsed(
  records: Array<{ kind: 'row'; row: ParsedImportRow } | { kind: 'issue'; issue: ParsedImportIssue } | { kind: 'empty' }>,
): ParsedImport {
  const rows: ParsedImportRow[] = []
  const issues: ParsedImportIssue[] = []
  let total = 0
  for (const record of records) {
    if (record.kind === 'empty') continue
    total += 1
    if (record.kind === 'row') rows.push(record.row)
    else issues.push(record.issue)
  }
  return { rows, issues, total }
}

function classifyRecord(
  record: Record<string, string>,
  rowNumber: number,
): { kind: 'row'; row: ParsedImportRow } | { kind: 'issue'; issue: ParsedImportIssue } | { kind: 'empty' } {
  const personId = pickField(record, PERSON_ID_KEYS)
  const email = pickField(record, EMAIL_KEYS)
  const driveUrl = pickField(record, DRIVE_URL_KEYS)
  const givenFileId = pickField(record, DRIVE_FILE_ID_KEYS)
  if (!personId && !email && !driveUrl && !givenFileId) return { kind: 'empty' }
  if (!driveUrl) {
    return { kind: 'issue', issue: { rowNumber, kind: 'no-link', reason: 'без линк' } }
  }
  const checked = validateDriveUrl(driveUrl)
  if (!checked.ok) {
    return { kind: 'issue', issue: { rowNumber, kind: 'invalid', reason: checked.reason } }
  }
  if (!personId && !email) {
    return { kind: 'issue', issue: { rowNumber, kind: 'invalid', reason: 'липсва personId или email' } }
  }
  const driveFileId = givenFileId || deriveDriveFileId(checked.url) || ''
  return {
    kind: 'row',
    row: { rowNumber, personId, email, driveUrl: checked.url, driveFileId },
  }
}

function pickField(record: Record<string, string>, aliases: string[]) {
  const map = new Map<string, string>()
  for (const [key, value] of Object.entries(record)) map.set(normalizeKey(key), value)
  for (const alias of aliases) {
    const value = map.get(normalizeKey(alias))
    if (value !== undefined && value.trim()) return value.trim()
  }
  for (const alias of aliases) {
    const value = map.get(normalizeKey(alias))
    if (value !== undefined) return value.trim()
  }
  return ''
}

function normalizeKey(key: string) {
  return key.trim().toLowerCase().replace(/^\uFEFF/, '').replace(/[\s-]+/g, '_')
}

export function validateDriveUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, reason: 'липсва driveUrl' }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'невалиден URL' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'driveUrl трябва да е https на drive.google.com или docs.google.com' }
  }
  const host = parsed.hostname.toLowerCase()
  if (host !== 'drive.google.com' && host !== 'docs.google.com') {
    return { ok: false, reason: 'driveUrl трябва да е https на drive.google.com или docs.google.com' }
  }
  return { ok: true, url: trimmed }
}

export function deriveDriveFileId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const file = parsed.pathname.match(/\/file\/d\/([^/]+)/)
  if (file?.[1]) return file[1]
  const document = parsed.pathname.match(/\/document\/d\/([^/]+)/)
  if (document?.[1]) return document[1]
  const id = parsed.searchParams.get('id')?.trim()
  return id || null
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

export function formatImportSummary(summary: DesignationImportSummary): string[] {
  const lines = [
    `внос: ${summary.rows} реда, ${summary.updated} обновени, ${summary.brevoSynced} в Brevo, ${summary.noLink} без линк, ${summary.notFound} ненамерени, ${summary.unpublished} без секция, ${summary.invalid} невалидни`,
  ]
  for (const detail of summary.details) lines.push(`ред ${detail.rowNumber}: ${detail.reason}`)
  for (const error of summary.errors) lines.push(error)
  return lines
}

export async function runDesignationImport(
  opts: DesignationImportOptions,
  deps: DesignationImportDeps,
): Promise<DesignationImportSummary> {
  const log = deps.log ?? (() => undefined)
  const fetchImpl = deps.fetchImpl ?? fetch
  const parsed = deps.parsed
  const summary: DesignationImportSummary = {
    rows: parsed.total,
    updated: 0,
    brevoSynced: 0,
    noLink: 0,
    notFound: 0,
    unpublished: 0,
    invalid: 0,
    details: [],
    errors: [],
  }
  for (const issue of parsed.issues) {
    if (issue.kind === 'no-link') summary.noLink += 1
    else {
      summary.invalid += 1
      summary.details.push({ rowNumber: issue.rowNumber, reason: issue.reason })
    }
  }

  const ids = [...new Set(parsed.rows.map((row) => row.personId).filter(Boolean))]
  const emails = [...new Set(parsed.rows.map((row) => row.email.trim().toLowerCase()).filter(Boolean))]
  const people = parsed.rows.length > 0 ? await deps.data.findPeople({ ids, emails }) : []
  const index = indexPeople(people)

  const pending: Array<{ rowNumber: number; person: DesignationImportPerson; pdfUrl: string; driveFileId: string | null }> = []
  for (const row of parsed.rows) {
    const resolved = resolvePerson(row, index)
    if (resolved.kind === 'error') {
      if (resolved.notFound) summary.notFound += 1
      else summary.invalid += 1
      summary.details.push({ rowNumber: row.rowNumber, reason: resolved.reason })
      continue
    }
    if (!resolved.person.publishedSection.trim()) {
      summary.unpublished += 1
      summary.details.push({
        rowNumber: row.rowNumber,
        reason: `няма публикувана секция (${labelFor(row)})`,
      })
      log(`ред ${row.rowNumber}: няма публикувана секция (${labelFor(row)})`)
      continue
    }
    pending.push({
      rowNumber: row.rowNumber,
      person: resolved.person,
      pdfUrl: row.driveUrl,
      driveFileId: row.driveFileId || null,
    })
  }

  if (opts.dryRun) {
    summary.updated = pending.length
    for (const item of pending) log(`план ${item.person.id} ${item.person.email}`)
    return summary
  }

  for (const batch of sqlBatches(pending, IMPORT_SAVE_BATCH)) {
    try {
      await deps.data.saveLinks(batch.map((item) => ({ id: item.person.id, pdfUrl: item.pdfUrl, driveFileId: item.driveFileId })))
      summary.updated += batch.length
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестна грешка'
      for (const item of batch) {
        summary.errors.push(`${item.person.id}: ${message}`)
        log(`грешка ${item.person.id}: ${message}`)
      }
    }
  }

  const shouldSyncBrevo = !opts.skipBrevo
  if (shouldSyncBrevo && !deps.brevoApiKey) {
    log('няма BREVO_API_KEY — пропускам синхрон към Brevo')
  }
  if (shouldSyncBrevo && deps.brevoApiKey) {
    const attribute = deps.config.brevoAttribute
    for (const item of pending) {
      if (summary.errors.some((line) => line.startsWith(`${item.person.id}:`))) continue
      // No e-mail: never a Brevo contact (no-email.ts); not an error.
      if (!hasRealEmail(item.person.email)) continue
      try {
        await updateBrevoContactAttribute(
          deps.brevoApiKey,
          item.person.email,
          { [attribute]: item.pdfUrl },
          fetchImpl,
        )
        summary.brevoSynced += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'неизвестна грешка'
        summary.errors.push(`${item.person.id}: Brevo ${message}`)
        log(`грешка ${item.person.id}: Brevo ${message}`)
      }
    }
  }

  return summary
}

function indexPeople(people: DesignationImportPerson[]) {
  const byId = new Map<string, DesignationImportPerson>()
  const byEmail = new Map<string, DesignationImportPerson[]>()
  for (const person of people) {
    byId.set(person.id, person)
    const key = person.email.trim().toLowerCase()
    if (!key) continue
    const list = byEmail.get(key) ?? []
    list.push(person)
    byEmail.set(key, list)
  }
  return { byId, byEmail }
}

function resolvePerson(
  row: ParsedImportRow,
  index: ReturnType<typeof indexPeople>,
): { kind: 'ok'; person: DesignationImportPerson } | { kind: 'error'; reason: string; notFound?: boolean } {
  const emailKey = row.email.trim().toLowerCase()
  const byId = row.personId ? index.byId.get(row.personId) : undefined
  const emailMatches = emailKey ? (index.byEmail.get(emailKey) ?? []) : []
  if (emailKey && emailMatches.length > 1) {
    return { kind: 'error', reason: `няколко signup-а с имейл ${row.email}` }
  }
  const byEmail = emailMatches[0]

  if (row.personId && emailKey) {
    if (byId && byEmail && byId.id !== byEmail.id) {
      return { kind: 'error', reason: `personId и email сочат към различни хора (${row.personId})` }
    }
    if (byId && byEmail && byId.id === byEmail.id) return { kind: 'ok', person: byId }
    if (byId && !byEmail) {
      if (byId.email.trim().toLowerCase() === emailKey) return { kind: 'ok', person: byId }
      return { kind: 'error', reason: `personId и email сочат към различни хора (${row.personId})` }
    }
    if (!byId && byEmail) {
      return { kind: 'error', reason: `personId и email сочат към различни хора (${row.personId})` }
    }
    return { kind: 'error', reason: `няма signup за ${labelFor(row)}`, notFound: true }
  }
  if (row.personId) {
    if (!byId) return { kind: 'error', reason: `няма signup за ${labelFor(row)}`, notFound: true }
    return { kind: 'ok', person: byId }
  }
  if (!byEmail) return { kind: 'error', reason: `няма signup за ${labelFor(row)}`, notFound: true }
  return { kind: 'ok', person: byEmail }
}

function labelFor(row: Pick<ParsedImportRow, 'personId' | 'email'>) {
  return [row.personId, row.email].filter(Boolean).join(' ')
}

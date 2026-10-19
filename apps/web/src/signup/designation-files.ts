import { unzipSync } from 'fflate'
import { toCsv } from './admin-csv'
import { ELECTION_DISTRICTS } from './designation-config'

/** Max unsigned PDFs (and people) in one ZIP request. */
export const DESIGNATION_ZIP_BATCH_LIMIT = 100

export const BULK_MANIFEST_COLUMNS = ['fileName', 'personId', 'number', 'section', 'mir', 'name'] as const

const CYRILLIC_MULTI: Array<[RegExp, string]> = [
  [/щ/gi, 'sht'],
  [/ю/gi, 'yu'],
  [/я/gi, 'ya'],
  [/ж/gi, 'zh'],
  [/ц/gi, 'ts'],
  [/ч/gi, 'ch'],
  [/ш/gi, 'sh'],
]

const CYRILLIC_SINGLE: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ъ: 'a',
  ь: 'y',
  ѝ: 'i',
}

export interface DesignationFilePerson {
  id: string
  number: number
  section: string
  lastName: string
  name: string
  hasDriveFile: boolean
}

/** Admin table row. Lives here so the page never imports the Worker server module. */
export interface DesignationPersonView {
  id: string
  number: number | null
  name: string
  lastName: string
  section: string
  mir: string
  generatedAt: string | null
  signedAt: string | null
  driveUrl: string | null
  hasDriveFile: boolean
}

export interface DesignationCounts {
  published: number
  numbered: number
  generated: number
  signed: number
  missing: number
}

export interface DesignationMirOption {
  code: string
  label: string
  count: number
}

export function toFilePerson(person: DesignationPersonView): DesignationFilePerson {
  return {
    id: person.id,
    number: person.number ?? 0,
    section: person.section,
    lastName: person.lastName,
    name: person.name,
    hasDriveFile: person.hasDriveFile || Boolean(person.driveUrl),
  }
}

export interface IncomingUploadFile {
  name: string
  bytes: Uint8Array
}

export type MatchedUpload = {
  kind: 'matched'
  fileName: string
  personId: string
  number: number
  name: string
  willReplace: boolean
  missingSigned: boolean
  bytes: Uint8Array
}

export type UnmatchedUpload = {
  kind: 'unmatched'
  fileName: string
  reason: string
}

export type DuplicateUpload = {
  kind: 'duplicate'
  personId: string
  number: number
  name: string
  fileNames: string[]
}

export type NotPdfUpload = {
  kind: 'not-pdf'
  fileName: string
  reason: string
}

export interface SignedUploadMatch {
  matched: MatchedUpload[]
  unmatched: UnmatchedUpload[]
  duplicates: DuplicateUpload[]
  notPdf: NotPdfUpload[]
}

export interface BulkManifestRow {
  fileName: string
  personId: string
  number: string
  section: string
  mir: string
  name: string
}

export function personIdOk(id: string) {
  return /^[\w-]{1,80}$/.test(id)
}

export function sectionDigits(section: string) {
  const digits = section.replace(/\D/g, '')
  if (!digits) return ''
  return digits.padStart(9, '0').slice(0, 9)
}

export function mirFromSection(section: string) {
  const digits = section.replace(/\D/g, '')
  return digits.length >= 2 ? digits.slice(0, 2) : ''
}

export function mirLabel(mir: string) {
  const name = ELECTION_DISTRICTS[mir]
  return name ? `${mir} ${name}` : mir
}

/**
 * Official Bulgarian streamlined transliteration (Закон за транслитерацията).
 * „ия“ at the end of a word → ia. Output is ASCII `[A-Za-z0-9-]` or `bez-ime`.
 */
export function transliterateBg(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(/[\s]+/).map((word) =>
    word
      .split('-')
      .map((piece) => transliteratePiece(piece))
      .filter(Boolean)
      .join('-'),
  )
  const joined = parts.filter(Boolean).join('-')
  const ascii = joined.replace(/[^A-Za-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return ascii
}

function transliteratePiece(piece: string) {
  let text = piece
  if (/ия$/i.test(text)) text = `${text.slice(0, -2)}ia`
  for (const [pattern, latin] of CYRILLIC_MULTI) text = text.replace(pattern, latin)
  let out = ''
  for (const char of text) {
    const lower = char.toLowerCase()
    const mapped = CYRILLIC_SINGLE[lower]
    out += mapped ?? char
  }
  return out
}

function titleCaseAscii(value: string) {
  return value
    .split('-')
    .map((part) => (part ? `${part[0]!.toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join('-')
}

export function transliterateLastName(lastName: string) {
  const ascii = transliterateBg(lastName)
  return ascii ? titleCaseAscii(ascii) : 'bez-ime'
}

export function padDesignationNumber(number: number) {
  const n = Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
  return String(n).padStart(4, '0')
}

/** `{0001}_{9-digit section}_{Lastname}.pdf` — integer only, even when a number prefix exists. */
export function bulkDesignationFilename(input: { number: number; section: string; lastName: string }) {
  const number = padDesignationNumber(input.number)
  const section = sectionDigits(input.section) || '000000000'
  const last = transliterateLastName(input.lastName)
  return `${number}_${section}_${last}.pdf`
}

export function bulkDesignationSignedFilename(input: { number: number; section: string; lastName: string }) {
  return bulkDesignationFilename(input).replace(/\.pdf$/i, '_signed.pdf')
}

export function isPdfBytes(bytes: Uint8Array) {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
}

export function isZipBytes(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
}

function dropDirectory(name: string) {
  const parts = name.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || name
}

function hasPdfExtension(name: string) {
  return /\.pdf$/i.test(dropDirectory(name).trim())
}

export function originalHasSignedMarker(name: string) {
  const base = dropDirectory(name).replace(/\.pdf$/i, '')
  return /(?:^|[\s_-])signed(?:$|[\s_-])/i.test(base)
}

/**
 * Trim, NFC, drop directories, strip `.pdf`, copy suffixes, `_signed`/`-signed`/` signed`, collapse spaces.
 */
export function normalizeDesignationFilename(name: string) {
  let value = name.normalize('NFC').trim()
  value = dropDirectory(value)
  value = value.replace(/\.pdf$/i, '')
  value = value.replace(/(?:\s*-\s*Copy(?:\s*\(\d+\))?|\s*\(\d+\))+$/i, '')
  value = value.replace(/[\s_-]*signed[\s_-]*$/i, '')
  value = value.replace(/[\s_-]+$/g, '').replace(/\s+/g, ' ').trim()
  return value
}

export function leadingDesignationNumber(normalized: string) {
  const match = normalized.match(/^(\d+)/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export function sectionFromFilename(normalized: string) {
  const match = normalized.match(/^\d+[_\-\s]+(\d{9})(?:[_\-\s]|$)/)
  return match ? match[1] : null
}

function expectedNormalized(person: DesignationFilePerson) {
  return normalizeDesignationFilename(bulkDesignationFilename(person))
}

function findPersonForFile(normalized: string, people: DesignationFilePerson[]) {
  const lower = normalized.toLowerCase()
  const exact = people.filter((person) => expectedNormalized(person).toLowerCase() === lower)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return exact[0]
  const number = leadingDesignationNumber(normalized)
  if (number == null) return null
  const section = sectionFromFilename(normalized)
  const numbered = people.filter((person) => person.number === number)
  const matched = numbered.filter((person) => {
    if (!section) return true
    return sectionDigits(person.section) === section
  })
  if (matched.length === 1) return matched[0]
  return null
}

export function matchSignedFiles(files: IncomingUploadFile[], people: DesignationFilePerson[]): SignedUploadMatch {
  const result: SignedUploadMatch = { matched: [], unmatched: [], duplicates: [], notPdf: [] }
  const byPerson = new Map<string, MatchedUpload[]>()

  for (const file of files) {
    const fileName = file.name
    if (!hasPdfExtension(fileName) || !isPdfBytes(file.bytes)) {
      result.notPdf.push({
        kind: 'not-pdf',
        fileName,
        reason: !hasPdfExtension(fileName) ? 'не е PDF (разширение)' : 'не е PDF (липсва %PDF-)',
      })
      continue
    }
    const normalized = normalizeDesignationFilename(fileName)
    if (!normalized) {
      result.unmatched.push({ kind: 'unmatched', fileName, reason: 'празно име' })
      continue
    }
    const person = findPersonForFile(normalized, people)
    if (!person) {
      const number = leadingDesignationNumber(normalized)
      const section = sectionFromFilename(normalized)
      const reason =
        number != null && section && people.some((row) => row.number === number)
          ? 'номерът съвпада, но секцията в името е друга'
          : number != null
            ? 'няма човек с този номер'
            : 'името не съвпада с очаквания файл'
      result.unmatched.push({ kind: 'unmatched', fileName, reason })
      continue
    }
    const row: MatchedUpload = {
      kind: 'matched',
      fileName,
      personId: person.id,
      number: person.number,
      name: person.name,
      willReplace: person.hasDriveFile,
      missingSigned: !originalHasSignedMarker(fileName),
      bytes: file.bytes,
    }
    const list = byPerson.get(person.id) ?? []
    list.push(row)
    byPerson.set(person.id, list)
  }

  for (const rows of byPerson.values()) {
    if (rows.length === 1) {
      result.matched.push(rows[0]!)
      continue
    }
    result.duplicates.push({
      kind: 'duplicate',
      personId: rows[0]!.personId,
      number: rows[0]!.number,
      name: rows[0]!.name,
      fileNames: rows.map((row) => row.fileName),
    })
  }

  result.matched.sort((a, b) => a.number - b.number || a.personId.localeCompare(b.personId))
  result.duplicates.sort((a, b) => a.number - b.number || a.personId.localeCompare(b.personId))
  return result
}

export function expandUploadFiles(files: IncomingUploadFile[]): IncomingUploadFile[] {
  const out: IncomingUploadFile[] = []
  for (const file of files) {
    const looksZip = /\.zip$/i.test(dropDirectory(file.name)) || isZipBytes(file.bytes)
    if (!looksZip) {
      out.push(file)
      continue
    }
    try {
      const unzipped = unzipSync(file.bytes)
      for (const [path, bytes] of Object.entries(unzipped)) {
        if (!bytes) continue
        if (path.endsWith('/')) continue
        const base = dropDirectory(path)
        if (!base || base === '.DS_Store' || path.includes('__MACOSX')) continue
        out.push({ name: path, bytes })
      }
    } catch {
      out.push(file)
    }
  }
  return out
}

export function serializeBulkManifestCsv(rows: BulkManifestRow[]): string {
  return toCsv(
    [...BULK_MANIFEST_COLUMNS],
    rows.map((row) => BULK_MANIFEST_COLUMNS.map((column) => row[column])),
  )
}

export function bulkManifestRow(person: DesignationFilePerson): BulkManifestRow {
  return {
    fileName: bulkDesignationFilename(person),
    personId: person.id,
    number: String(person.number),
    section: sectionDigits(person.section) || person.section,
    mir: mirFromSection(person.section),
    name: person.name,
  }
}

export function zipBatchPlan(count: number, size = DESIGNATION_ZIP_BATCH_LIMIT) {
  const step = Math.max(1, Math.floor(size) || 1)
  const batches: Array<{ offset: number; limit: number; from: number; to: number }> = []
  for (let offset = 0; offset < count; offset += step) {
    const limit = Math.min(step, count - offset)
    batches.push({ offset, limit, from: offset + 1, to: offset + limit })
  }
  return batches
}

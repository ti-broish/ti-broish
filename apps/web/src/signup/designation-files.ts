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
  firstName: string
  middleName: string
  lastName: string
  name: string
  hasDriveFile: boolean
  /** Partner slug („И аз“): `section` holds only the МИР. */
  partner?: string
}

/** Admin table row. Lives here so the page never imports the Worker server module. */
export interface DesignationPersonView {
  id: string
  number: number | null
  name: string
  firstName: string
  middleName: string
  lastName: string
  section: string
  mir: string
  generatedAt: string | null
  signedAt: string | null
  driveUrl: string | null
  hasDriveFile: boolean
  /** Partner slug for „И аз“ people (not signups; only for пълномощни). */
  partner?: string
  /** Same ЕГН already holds № X (in this or the other table): no number, ZIP or РИК task for this row. */
  duplicateOf?: { number: number; mir: string }
  /** „И аз“ only: the пълномощно was withdrawn („Оттеглено“); number and МИР stay. */
  withdrawnAt?: string
  withdrawnReason?: string
  /** „И аз“ only: an active volunteer has the same ЕГН („покрит от доброволец“); never numbered. */
  covered?: boolean
}

/** „И аз“ partner people, counted apart from signups. Counts are for active (not withdrawn) rows. */
export interface DesignationPartnerCounts {
  total: number
  numbered: number
  noMir: number
  signed: number
  withdrawn?: number
  covered?: number
}

/** The „Състояние“ numbers for one group of people. */
export interface DesignationCountsPart {
  published: number
  numbered: number
  generated: number
  signed: number
  /** Without a signed пълномощно (= the three `missingSteps`). */
  missing: number
  /** Where the `missing` people are; the three always add up to `missing`. */
  missingSteps?: DesignationMissingSteps
}

/**
 * Everyone who can get an пълномощно: published volunteers plus active „И аз“ partner people,
 * without withdrawn rows and ЕГН duplicates (the same people the signing ZIP scopes count).
 */
export interface DesignationCounts extends DesignationCountsPart {
  /** The „И аз“ (external organisations) part of every number above. */
  partner?: DesignationCountsPart
  /** Rows whose ЕГН already holds another number (badge „Дубликат“). */
  duplicates?: number
}

/**
 * People without a signed пълномощно, by step. „Downloaded for signing“ is
 * designation_signing_generated_at, the same marker the „Само новите“ ZIP scope uses.
 */
export interface DesignationMissingSteps {
  /** No number yet. */
  noNumber: number
  /** Numbered, never in a ZIP for signing. */
  notDownloaded: number
  /** In a ZIP for signing, no signed file yet. */
  awaitingSignature: number
}

type CountedPerson = { number: number | null; generatedAt: string | null; signingGeneratedAt: string | null; signedAt: string | null }

export function designationCountsPart(people: ReadonlyArray<CountedPerson>): DesignationCountsPart {
  return {
    published: people.length,
    numbered: people.filter((row) => row.number != null).length,
    generated: people.filter((row) => row.generatedAt).length,
    signed: people.filter((row) => row.signedAt).length,
    missing: people.filter((row) => !row.signedAt).length,
    missingSteps: designationMissingSteps(people),
  }
}

export function designationMissingSteps(
  people: ReadonlyArray<{ number: number | null; signingGeneratedAt: string | null; signedAt: string | null }>,
): DesignationMissingSteps {
  const steps: DesignationMissingSteps = { noNumber: 0, notDownloaded: 0, awaitingSignature: 0 }
  for (const person of people) {
    if (person.signedAt) continue
    if (person.number == null) steps.noNumber += 1
    else if (!person.signingGeneratedAt) steps.notDownloaded += 1
    else steps.awaitingSignature += 1
  }
  return steps
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
    firstName: person.firstName,
    middleName: person.middleName,
    lastName: person.lastName,
    name: person.name,
    hasDriveFile: person.hasDriveFile || Boolean(person.driveUrl),
    ...(person.partner ? { partner: person.partner } : {}),
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
  /** macOS/Windows junk inside a ZIP or folder (__MACOSX, ._*, .DS_Store): skipped, never an error. */
  ignored: number
}

/** A selected file that never reached matching: unreadable (a dropped folder) or a broken ZIP. */
export interface UploadProblem {
  fileName: string
  reason: string
}

export interface ExpandedUploads {
  files: IncomingUploadFile[]
  problems: UploadProblem[]
  ignored: number
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

/**
 * One name part for a filename: keep Cyrillic, turn spaces/hyphens into `_`,
 * drop characters Windows/macOS reject in names, collapse repeats.
 */
export function sanitizeFilenameNamePart(part: string) {
  return part
    .normalize('NFC')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/[\s\-–—]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/** `{МИР}_{номер}_{Име}_{Презиме?}_{Фамилия}.pdf` — Cyrillic names, no padded number, no empty middle. */
export function bulkDesignationFilename(input: {
  number: number
  section: string
  firstName?: string
  middleName?: string
  lastName?: string
}) {
  const mir = mirFromSection(input.section) || '00'
  const n = Number.isFinite(input.number) && input.number > 0 ? Math.floor(input.number) : 0
  const parts = [input.firstName, input.middleName, input.lastName]
    .map((part) => sanitizeFilenameNamePart(part ?? ''))
    .filter(Boolean)
  const name = parts.join('_') || 'без-име'
  return `${mir}_${n}_${name}.pdf`
}

/** Pre-v0.0.16 ASCII form `{0001}_{9-digit section}_{Lastname}.pdf` — still accepted on upload. */
export function legacyBulkDesignationFilename(input: { number: number; section: string; lastName: string }) {
  const number = padDesignationNumber(input.number)
  const section = sectionDigits(input.section) || '000000000'
  const last = transliterateLastName(input.lastName)
  return `${number}_${section}_${last}.pdf`
}

export function bulkDesignationSignedFilename(input: {
  number: number
  section: string
  firstName?: string
  middleName?: string
  lastName?: string
}) {
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

function legacyExpectedNormalized(person: DesignationFilePerson) {
  return normalizeDesignationFilename(legacyBulkDesignationFilename(person))
}

/** New `{МИР}_{номер}_…` or legacy `{номер}_{9-digit section}_…`. */
export function parseDesignationFilenameParts(normalized: string): {
  style: 'new' | 'legacy'
  mir: string | null
  number: number
  section: string | null
} | null {
  const neu = normalized.match(/^(\d{1,2})_(\d+)(?:_|$)/)
  if (neu) {
    const number = Number(neu[2])
    if (!Number.isFinite(number) || number <= 0) return null
    return { style: 'new', mir: neu[1]!.padStart(2, '0'), number, section: null }
  }
  const number = leadingDesignationNumber(normalized)
  if (number == null) return null
  return { style: 'legacy', mir: null, number, section: sectionFromFilename(normalized) }
}

interface PeopleIndex {
  exact: Map<string, DesignationFilePerson>
  legacy: Map<string, DesignationFilePerson>
  people: DesignationFilePerson[]
}

/** Expected names once per person, not once per person per file (thousands of people × a ZIP of 100). */
function indexPeople(people: DesignationFilePerson[]): PeopleIndex {
  const exact = new Map<string, DesignationFilePerson>()
  const legacy = new Map<string, DesignationFilePerson>()
  for (const person of people) {
    const key = expectedNormalized(person).toLowerCase()
    if (!exact.has(key)) exact.set(key, person)
    const legacyKey = legacyExpectedNormalized(person).toLowerCase()
    if (!legacy.has(legacyKey)) legacy.set(legacyKey, person)
  }
  return { exact, legacy, people }
}

function findPersonForFile(normalized: string, index: PeopleIndex) {
  const lower = normalized.toLowerCase()
  const exact = index.exact.get(lower)
  if (exact) return exact
  const legacyExact = index.legacy.get(lower)
  if (legacyExact) return legacyExact
  const people = index.people
  const parts = parseDesignationFilenameParts(normalized)
  if (!parts) return null
  if (parts.style === 'new') {
    const matched = people.filter(
      (person) => person.number === parts.number && mirFromSection(person.section) === parts.mir,
    )
    return matched.length === 1 ? matched[0] : null
  }
  const numbered = people.filter((person) => person.number === parts.number)
  const matched = numbered.filter((person) => {
    if (!parts.section) return true
    return sectionDigits(person.section) === parts.section
  })
  return matched.length === 1 ? matched[0] : null
}

export function matchSignedFiles(
  files: IncomingUploadFile[],
  people: DesignationFilePerson[],
  extra: { problems?: UploadProblem[]; ignored?: number } = {},
): SignedUploadMatch {
  const result: SignedUploadMatch = { matched: [], unmatched: [], duplicates: [], notPdf: [], ignored: extra.ignored ?? 0 }
  const byPerson = new Map<string, MatchedUpload[]>()
  const index = indexPeople(people)
  for (const problem of extra.problems ?? []) {
    result.notPdf.push({ kind: 'not-pdf', fileName: problem.fileName, reason: problem.reason })
  }

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
    const person = findPersonForFile(normalized, index)
    if (!person) {
      const parts = parseDesignationFilenameParts(normalized)
      let reason = 'името не започва с МИР_номер_ (напр. 23_501_…_signed.pdf)'
      if (parts?.style === 'new') {
        reason = people.some((row) => row.number === parts.number)
          ? 'номерът съвпада, но МИР в името е друг'
          : people.some((row) => mirFromSection(row.section) === parts.mir)
            ? 'няма човек с този номер в този МИР (или не е в текущия филтър)'
            : 'няма човек с този номер (провери филтъра по МИР/търсенето)'
      } else if (parts) {
        reason =
          parts.section && people.some((row) => row.number === parts.number)
            ? 'номерът съвпада, но секцията в името е друга'
            : 'няма човек с този номер'
      }
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

/** Nested ZIPs (a ZIP of ZIPs) are opened this deep; anything deeper is reported, not silently dropped. */
const MAX_ZIP_DEPTH = 3

const JUNK_BASENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.localized', 'icon\r'])

/**
 * macOS Finder („Compress“), Windows Explorer and others mark junk alongside the real files:
 * `__MACOSX/` AppleDouble copies, `._name` resource forks, `.DS_Store`, `Thumbs.db`.
 */
export function isJunkUploadPath(path: string) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.some((part) => part === '__MACOSX')) return true
  const base = parts[parts.length - 1] ?? ''
  if (!base) return true
  if (base.startsWith('._')) return true
  return JUNK_BASENAMES.has(base.toLowerCase())
}

const utf8Strict = typeof TextDecoder === 'undefined' ? null : new TextDecoder('utf-8', { fatal: true })

/**
 * fflate decodes an entry name as Latin-1 unless the ZIP sets the UTF-8 flag (bit 11). macOS Archive
 * Utility and many Windows tools write UTF-8 names without that flag, so Cyrillic arrives as mojibake
 * („ÐÐ²Ð°Ð½“). Latin-1 is byte-for-byte, so turn it back into bytes and decode as UTF-8 when that is
 * valid; otherwise keep the name as it came. NFC folds macOS decomposed „й“ (и + ˘).
 */
export function decodeZipEntryName(name: string) {
  let restored = name
  if (utf8Strict && /[\u0080-\u00ff]/.test(name) && !/[^\u0000-\u00ff]/.test(name)) {
    const bytes = new Uint8Array(name.length)
    for (let i = 0; i < name.length; i += 1) bytes[i] = name.charCodeAt(i)
    try {
      restored = utf8Strict.decode(bytes)
    } catch {
      restored = name
    }
  }
  return restored.normalize('NFC')
}

function looksLikeZip(file: IncomingUploadFile) {
  return /\.zip$/i.test(dropDirectory(file.name)) || isZipBytes(file.bytes)
}

/**
 * Open every ZIP (also a ZIP inside a ZIP, and PDFs inside any folder depth), drop junk entries,
 * and report the ones that cannot be opened instead of passing them on as „not a PDF“.
 */
export function expandUploadFilesDetailed(files: IncomingUploadFile[]): ExpandedUploads {
  const out: ExpandedUploads = { files: [], problems: [], ignored: 0 }
  const visit = (file: IncomingUploadFile, depth: number) => {
    if (isJunkUploadPath(file.name)) {
      out.ignored += 1
      return
    }
    if (!looksLikeZip(file)) {
      out.files.push({ name: file.name.normalize('NFC'), bytes: file.bytes })
      return
    }
    if (depth >= MAX_ZIP_DEPTH) {
      out.problems.push({ fileName: file.name, reason: `ZIP в ZIP повече от ${MAX_ZIP_DEPTH} нива: разархивирай го` })
      return
    }
    let unzipped: Record<string, Uint8Array>
    try {
      unzipped = unzipSync(file.bytes)
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
      out.problems.push({ fileName: file.name, reason: `ZIP архивът не се отваря${detail}` })
      return
    }
    const prefix = depth === 0 ? '' : `${file.name}/`
    for (const [rawPath, bytes] of Object.entries(unzipped)) {
      const path = decodeZipEntryName(rawPath)
      if (path.endsWith('/')) continue
      if (!bytes) continue
      if (isJunkUploadPath(path)) {
        out.ignored += 1
        continue
      }
      visit({ name: `${prefix}${path}`, bytes }, depth + 1)
    }
  }
  for (const file of files) visit(file, 0)
  return out
}

export function expandUploadFiles(files: IncomingUploadFile[]): IncomingUploadFile[] {
  return expandUploadFilesDetailed(files).files
}

/**
 * Why „Качи подписани“ is disabled, in words, so the button is never silently grey.
 * Empty string means it can be pressed.
 */
export function signedUploadBlockReason(input: {
  canExport: boolean
  canUploadDrive: boolean
  busy: boolean
  reading: boolean
  preview: SignedUploadMatch | null
  /** „Замени и вече качените“: people who already have a signed file are uploaded again. */
  replaceExisting?: boolean
}) {
  if (!input.canExport) return 'Нужно е право за експорт (редактор или админ).'
  if (!input.canUploadDrive) return 'Drive не е настроен. Виж реда за здраве по-горе.'
  if (input.reading) return 'Четем файловете…'
  if (input.busy) return ''
  const preview = input.preview
  if (!preview) return 'Избери PDF-и, ZIP или папка (или ги пусни тук).'
  if (preview.matched.length > 0) {
    const plan = signedUploadPlan(preview, input.replaceExisting ?? false)
    if (plan.toUpload.length > 0) return ''
    return `Всички ${plan.already.length} съвпаднали вече имат качен подписан файл. Отметни „Замени и вече качените“, ако искаш да ги качиш наново.`
  }
  const bits: string[] = []
  if (preview.unmatched.length) bits.push(`${preview.unmatched.length} без съвпадение`)
  if (preview.duplicates.length) bits.push(`${preview.duplicates.length} с дубликати`)
  if (preview.notPdf.length) bits.push(`${preview.notPdf.length} не са PDF или не се четат`)
  if (bits.length === 0) return 'В избраното няма PDF файлове.'
  return `Няма файл за качване: ${bits.join(', ')}. Причината за всеки е в таблицата.`
}

/**
 * Re-uploading a whole ZIP is safe: people who already have a signed file are skipped
 * („вече качени N“) unless the admin explicitly asks to replace them.
 */
export function signedUploadPlan(preview: SignedUploadMatch, replaceExisting: boolean) {
  if (replaceExisting) return { toUpload: preview.matched, already: [] as MatchedUpload[] }
  return {
    toUpload: preview.matched.filter((row) => !row.willReplace),
    already: preview.matched.filter((row) => row.willReplace),
  }
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
    section: person.partner ? '' : sectionDigits(person.section) || person.section,
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

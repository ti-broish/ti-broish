import { formatBgDate, formatDesignationNumber } from './designation-config'
import { bulkDesignationSignedFilename } from './designation-files'
import { formatNumberWithDate, parseStoredNumber } from './designation-number'
import { partnerDuplicateSql, signupDuplicateSql } from './designation-duplicates'
export { SIGNED_WAVE_COLUMNS, SIGNED_WAVE_SET_SQL, SIGNING_WAVE_SCHEMA } from './signed-waves-sql'
import { issueDateKeySql } from './signed-waves-sql'
import { buildRikTableXlsx, rikTableFilename, rikTableTitle, sortRikRows, type RikTableRow } from './rik-table'

/**
 * Waves of пълномощни for the РИК. A wave is the date printed in the PDF (designation_issued_at),
 * the date the РИК has, never the day the signed file was uploaded. „Изпратена на РИК“ closes the
 * open wave of a date (signing_waves, designation_wave_id); anyone numbered later with that date
 * is the next wave, so one date can have several waves. A late signed upload stays in its wave.
 * Waves are numbered in date order, closed before open within a date.
 */
export interface SignedPerson {
  id: string
  firstName: string
  middleName: string
  lastName: string
  egn: string
  mir: string
  number: number
  issuedAt: string
  /** designation_issued_at as YYYY-MM-DD: the wave date. */
  issueKey: string
  /** Closed wave id, '' while the person is in the open wave of issueKey. */
  waveId: string
  /** First signed upload, '' when not signed yet. Only for display, never the wave. */
  firstSignedAt: string
  signed: boolean
  driveFileId: string
  partner: boolean
  /** The name the РИК still has (renamed after it went out); the wave ZIP adds a „Поправки“ table. */
  correctionFrom?: string
  /** „Поправи име/ЕГН“ changed the ЕГН after the РИК got the old one: the old ЕГН. */
  correctionEgnFrom?: string
}

export interface ClosedWaveRow {
  id: string
  issue_date: string
  closed_at: string
  closed_by: string | null
}

export interface SignedWave {
  /** Closed: the wave id. Open: its date, YYYY-MM-DD. */
  key: string
  wave: number
  /** dd.mm.yyyy, the date in the PDFs. */
  date: string
  issueKey: string
  closed: boolean
  closedAt: string
  closedBy: string
  /** Signed people (in the ZIP and the РИК tables). */
  count: number
  /** Everyone numbered in the wave, signed or not. */
  total: number
  partners: number
  mirs: Array<{ mir: string; count: number }>
}

export interface SignedRow {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  egn: string | null
  mir: string | null
  designation_number: number | string | null
  issued_at: string | null
  issue_key?: string | null
  wave_id?: string | null
  signed_at?: string | null
  first_signed_at: string | null
  drive_file_id: string | null
  partner: number | null
}

/**
 * Everyone numbered, signups (not withdrawn) and „И аз“ partner people (not withdrawn), signed or
 * not, never a duplicate (same ЕГН keeps another number).
 */
export const WAVE_PEOPLE_SQL = `SELECT id,
    json_extract(payload, '$.firstName') AS first_name,
    json_extract(payload, '$.middleName') AS middle_name,
    json_extract(payload, '$.lastName') AS last_name,
    COALESCE(egn, '') AS egn,
    COALESCE(NULLIF(designation_mir, ''), substr(COALESCE(published_section, ''), 1, 2)) AS mir,
    designation_number, COALESCE(designation_issued_at, '') AS issued_at, ${issueDateKeySql()} AS issue_key,
    COALESCE(designation_wave_id, '') AS wave_id, designation_signed_at AS signed_at,
    COALESCE(designation_first_signed_at, designation_signed_at) AS first_signed_at,
    COALESCE(designation_drive_file_id, '') AS drive_file_id, 0 AS partner
  FROM signups
  WHERE designation_number IS NOT NULL AND COALESCE(withdrawn, 0) = 0
    AND NOT ${signupDuplicateSql('signups')}
UNION ALL
SELECT id, first_name, middle_name, last_name, COALESCE(egn, '') AS egn, COALESCE(designation_mir, '') AS mir,
    designation_number, COALESCE(designation_issued_at, '') AS issued_at, ${issueDateKeySql()} AS issue_key,
    COALESCE(designation_wave_id, '') AS wave_id, designation_signed_at AS signed_at,
    COALESCE(designation_first_signed_at, designation_signed_at) AS first_signed_at,
    COALESCE(designation_drive_file_id, '') AS drive_file_id, 1 AS partner
  FROM partner_people
  WHERE designation_number IS NOT NULL AND withdrawn_at IS NULL
    AND NOT ${partnerDuplicateSql('partner_people')}`

/** Only the signed ones (what the wave ZIP and the РИК tables hold). */
export const SIGNED_PEOPLE_SQL = `SELECT * FROM (${WAVE_PEOPLE_SQL}) WHERE signed_at IS NOT NULL`

export function signedPersonFromRow(row: SignedRow): SignedPerson | null {
  const number = parseStoredNumber(row.designation_number)
  const mir = (row.mir ?? '').trim()
  const issuedAt = (row.issued_at ?? '').trim()
  const issueKey = (row.issue_key ?? '').trim() || issueKeyOf(issuedAt)
  if (number == null || !/^\d{2}$/.test(mir) || !/^\d{4}-\d{2}-\d{2}$/.test(issueKey)) return null
  const firstSignedAt = (row.first_signed_at ?? '').trim()
  const signed = row.signed_at === undefined ? Boolean(firstSignedAt) : Boolean((row.signed_at ?? '').trim())
  return {
    id: row.id,
    firstName: (row.first_name ?? '').trim(),
    middleName: (row.middle_name ?? '').trim(),
    lastName: (row.last_name ?? '').trim(),
    egn: (row.egn ?? '').trim(),
    mir,
    number,
    issuedAt,
    issueKey,
    waveId: (row.wave_id ?? '').trim(),
    firstSignedAt,
    signed,
    driveFileId: (row.drive_file_id ?? '').trim(),
    partner: Number(row.partner ?? 0) === 1,
  }
}

/** dd.mm.yyyy or YYYY-MM-DD… as YYYY-MM-DD, '' otherwise. */
export function issueKeyOf(value: string) {
  const trimmed = value.trim()
  const bg = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed)
  if (bg) return `${bg[3]}-${bg[2]}-${bg[1]}`
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed)
  return iso ? iso[1]! : ''
}

/** `YYYY-MM-DD` of an ISO timestamp in Europe/Sofia, or '' when it does not parse. */
export function sofiaDateKey(iso: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** The wave a person is in: their closed wave, or the open wave of their PDF date. */
export function waveKeyOf(person: SignedPerson, closedIds: ReadonlySet<string>) {
  return person.waveId && closedIds.has(person.waveId) ? person.waveId : person.issueKey
}

/**
 * Closed waves plus one open wave per date that still has people without a wave. In date order;
 * within a date the closed ones by closing time, then the open one.
 */
export function signedWaves(people: SignedPerson[], closed: ClosedWaveRow[] = []): SignedWave[] {
  const closedIds = new Set(closed.map((row) => row.id))
  const byKey = new Map<string, SignedPerson[]>()
  for (const person of people) {
    const key = waveKeyOf(person, closedIds)
    byKey.set(key, [...(byKey.get(key) ?? []), person])
  }
  const entries: Array<{ key: string; issueKey: string; closed: boolean; closedAt: string; closedBy: string }> = closed.map((row) => ({
    key: row.id,
    issueKey: row.issue_date,
    closed: true,
    closedAt: row.closed_at,
    closedBy: (row.closed_by ?? '').trim(),
  }))
  for (const key of byKey.keys()) {
    if (!closedIds.has(key)) entries.push({ key, issueKey: key, closed: false, closedAt: '', closedBy: '' })
  }
  entries.sort(
    (a, b) =>
      a.issueKey.localeCompare(b.issueKey) ||
      Number(a.closed === false) - Number(b.closed === false) ||
      a.closedAt.localeCompare(b.closedAt) ||
      a.key.localeCompare(b.key),
  )
  return entries.map((entry, index) => {
    const members = byKey.get(entry.key) ?? []
    const signed = members.filter((person) => person.signed)
    return {
      ...entry,
      wave: index + 1,
      date: formatBgDate(entry.issueKey),
      count: signed.length,
      total: members.length,
      partners: signed.filter((person) => person.partner).length,
      mirs: countByMir(signed),
    }
  })
}

export function countByMir(people: SignedPerson[]) {
  const counts = new Map<string, number>()
  for (const person of people) counts.set(person.mir, (counts.get(person.mir) ?? 0) + 1)
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mir, count]) => ({ mir, count }))
}

/** Signed people of one wave (its key), or everyone signed so far for 'all'. */
export function peopleInWave(people: SignedPerson[], wave: string, closed: ClosedWaveRow[] = []) {
  const signed = people.filter((person) => person.signed)
  if (wave === 'all') return signed
  const closedIds = new Set(closed.map((row) => row.id))
  return signed.filter((person) => waveKeyOf(person, closedIds) === wave)
}

export function rikRowFor(person: SignedPerson, numberPrefix: string): RikTableRow {
  return {
    number: person.number,
    name: [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' '),
    egn: person.egn,
    numberWithDate: formatNumberWithDate(formatDesignationNumber(person.number, numberPrefix), formatBgDate(person.issuedAt)),
  }
}

export const RIK_CORRECTION_TITLE_PREFIX = 'Поправка на имената в списъка на упълномощените представители на \n'

export function rikCorrectionsFilename(mir: string) {
  return `РИК ${mir.padStart(2, '0')} Поправки.xlsx`
}

/** A „Поправки“ row: same number, the new name and ЕГН, and what the РИК has now. */
export function rikCorrectionRowFor(person: SignedPerson, numberPrefix: string): RikTableRow {
  const row = rikRowFor(person, numberPrefix)
  const was = [person.correctionFrom ? `вместо „${person.correctionFrom}“` : '', person.correctionEgnFrom ? `ЕГН вместо ${person.correctionEgnFrom}` : ''].filter(Boolean)
  return { ...row, name: `${row.name} (${was.join('; ') || 'вместо „“'})` }
}

export function hasRikCorrection(person: SignedPerson) {
  return Boolean(person.correctionFrom || person.correctionEgnFrom)
}

export function signedPdfName(person: SignedPerson) {
  return bulkDesignationSignedFilename({
    number: person.number,
    section: person.mir,
    firstName: person.firstName,
    middleName: person.middleName,
    lastName: person.lastName,
  })
}

/** One folder per РИК: „РИК 02/РИК 02 Представители.xlsx“ next to that РИК's signed PDFs. */
export function rikFolder(mir: string) {
  return `РИК ${mir}`
}

export const MISSING_PDFS_FILENAME = 'ЛИПСВАЩИ_PDF.txt'

/**
 * Drive downloads in flight at once for the signed ZIP. One at a time, „all“ (~270 PDFs on
 * 22.10.2026) took minutes and the browser was given up at 30–90 s.
 */
export const SIGNED_PDF_FETCH_WINDOW = 6

/** Runs `fn` over `items` at most `window` ahead of the reader, which takes results in order. */
export function orderedPrefetch<T, R>(items: readonly T[], window: number, fn: (item: T) => Promise<R>) {
  const started: Promise<R>[] = []
  let next = 0
  return (index: number): Promise<R> => {
    while (next < items.length && next < index + Math.max(1, window)) {
      const job = fn(items[next]!)
      job.catch(() => {})
      started[next] = job
      next += 1
    }
    return started[index]!
  }
}

/**
 * Writes the wave ZIP: per РИК a table and (unless tablesOnly) the signed PDFs fetched from
 * Drive. A PDF that cannot be fetched is listed in ЛИПСВАЩИ_PDF.txt (file names only, no
 * ЕГН); the tables are always complete.
 */
export async function writeSignedWaveZip(
  add: (name: string, bytes: Uint8Array) => Promise<void>,
  input: {
    people: SignedPerson[]
    committeeFullName: string
    numberPrefix: string
    tablesOnly: boolean
    fetchPdf: ((fileId: string) => Promise<Uint8Array>) | null
  },
) {
  const title = rikTableTitle(input.committeeFullName)
  const missing: string[] = []
  const mirs = [...new Set(input.people.map((person) => person.mir))].sort()
  const membersOf = new Map(mirs.map((mir) => [mir, input.people.filter((person) => person.mir === mir).sort((a, b) => a.number - b.number)]))
  const fetchPdf = input.fetchPdf
  const downloads = input.tablesOnly || !fetchPdf ? [] : mirs.flatMap((mir) => membersOf.get(mir)!.filter((person) => person.driveFileId))
  const takePdf = orderedPrefetch(downloads, SIGNED_PDF_FETCH_WINDOW, (person) => fetchPdf!(person.driveFileId))
  let taken = 0
  for (const mir of mirs) {
    const members = membersOf.get(mir)!
    const folder = rikFolder(mir)
    const rows = sortRikRows(members.map((person) => rikRowFor(person, input.numberPrefix)))
    await add(`${folder}/${rikTableFilename(mir)}`, buildRikTableXlsx({ title, rows }))
    const corrections = members.filter(hasRikCorrection)
    if (corrections.length > 0) {
      await add(
        `${folder}/${rikCorrectionsFilename(mir)}`,
        buildRikTableXlsx({
          title: `${RIK_CORRECTION_TITLE_PREFIX}${input.committeeFullName.trim()}`,
          rows: sortRikRows(corrections.map((person) => rikCorrectionRowFor(person, input.numberPrefix))),
        }),
      )
    }
    if (input.tablesOnly) continue
    for (const person of members) {
      const name = signedPdfName(person)
      if (!fetchPdf || !person.driveFileId) {
        missing.push(`${folder}/${name}`)
        continue
      }
      const pdf = takePdf(taken)
      taken += 1
      try {
        await add(`${folder}/${name}`, await pdf)
      } catch {
        missing.push(`${folder}/${name}`)
      }
    }
  }
  if (missing.length > 0) {
    const text = ['Тези подписани PDF-и не можаха да се изтеглят от Drive. Таблиците по-горе са пълни.', '', ...missing, ''].join('\r\n')
    await add(MISSING_PDFS_FILENAME, new TextEncoder().encode(text))
  }
  return { missing: missing.length, mirs: mirs.length }
}

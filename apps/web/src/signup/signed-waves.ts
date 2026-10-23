import { formatBgDate, formatDesignationNumber } from './designation-config'
import { bulkDesignationSignedFilename } from './designation-files'
import { formatNumberWithDate, parseStoredNumber } from './designation-number'
import { partnerDuplicateSql, signupDuplicateSql } from './designation-duplicates'
export { SIGNED_WAVE_COLUMNS, SIGNED_WAVE_SET_SQL } from './signed-waves-sql'
import { buildRikTableXlsx, rikTableFilename, rikTableTitle, sortRikRows, type RikTableRow } from './rik-table'

/**
 * Waves of signed пълномощни. A wave is one Sofia calendar day of first signed uploads:
 * everyone whose signed PDF was first uploaded on that day. Re-uploading a corrected PDF
 * later replaces the file but keeps the person in their original wave
 * (designation_first_signed_at is written once). Waves are numbered by date: the first
 * day with signed uploads is wave 1.
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
  firstSignedAt: string
  driveFileId: string
  partner: boolean
  /** The name the РИК still has (renamed after it went out); the wave ZIP adds a „Поправки“ table. */
  correctionFrom?: string
  /** „Поправи име/ЕГН“ changed the ЕГН after the РИК got the old one: the old ЕГН. */
  correctionEgnFrom?: string
}

export interface SignedWave {
  key: string
  wave: number
  date: string
  count: number
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
  first_signed_at: string | null
  drive_file_id: string | null
  partner: number | null
}

/**
 * Everyone with a signed пълномощно, signups (not withdrawn) and „И аз“ partner people (not withdrawn),
 * never a duplicate (same ЕГН keeps another number).
 * The wave timestamp falls back to designation_signed_at for rows signed before the
 * first-signed column existed.
 */
export const SIGNED_PEOPLE_SQL = `SELECT id,
    json_extract(payload, '$.firstName') AS first_name,
    json_extract(payload, '$.middleName') AS middle_name,
    json_extract(payload, '$.lastName') AS last_name,
    COALESCE(egn, '') AS egn,
    COALESCE(NULLIF(designation_mir, ''), substr(COALESCE(published_section, ''), 1, 2)) AS mir,
    designation_number, COALESCE(designation_issued_at, '') AS issued_at,
    COALESCE(designation_first_signed_at, designation_signed_at) AS first_signed_at,
    COALESCE(designation_drive_file_id, '') AS drive_file_id, 0 AS partner
  FROM signups
  WHERE designation_signed_at IS NOT NULL AND designation_number IS NOT NULL AND COALESCE(withdrawn, 0) = 0
    AND NOT ${signupDuplicateSql('signups')}
UNION ALL
SELECT id, first_name, middle_name, last_name, COALESCE(egn, '') AS egn, COALESCE(designation_mir, '') AS mir,
    designation_number, COALESCE(designation_issued_at, '') AS issued_at,
    COALESCE(designation_first_signed_at, designation_signed_at) AS first_signed_at,
    COALESCE(designation_drive_file_id, '') AS drive_file_id, 1 AS partner
  FROM partner_people
  WHERE designation_signed_at IS NOT NULL AND designation_number IS NOT NULL AND withdrawn_at IS NULL
    AND NOT ${partnerDuplicateSql('partner_people')}`

export function signedPersonFromRow(row: SignedRow): SignedPerson | null {
  const number = parseStoredNumber(row.designation_number)
  const mir = (row.mir ?? '').trim()
  const firstSignedAt = (row.first_signed_at ?? '').trim()
  if (number == null || !/^\d{2}$/.test(mir) || !firstSignedAt || !sofiaDateKey(firstSignedAt)) return null
  return {
    id: row.id,
    firstName: (row.first_name ?? '').trim(),
    middleName: (row.middle_name ?? '').trim(),
    lastName: (row.last_name ?? '').trim(),
    egn: (row.egn ?? '').trim(),
    mir,
    number,
    issuedAt: (row.issued_at ?? '').trim(),
    firstSignedAt,
    driveFileId: (row.drive_file_id ?? '').trim(),
    partner: Number(row.partner ?? 0) === 1,
  }
}

/** `YYYY-MM-DD` of an ISO timestamp in Europe/Sofia, or '' when it does not parse. */
export function sofiaDateKey(iso: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function signedWaves(people: SignedPerson[]): SignedWave[] {
  const byDay = new Map<string, SignedPerson[]>()
  for (const person of people) {
    const key = sofiaDateKey(person.firstSignedAt)
    if (!key) continue
    byDay.set(key, [...(byDay.get(key) ?? []), person])
  }
  return [...byDay.keys()].sort().map((key, index) => {
    const members = byDay.get(key) ?? []
    return {
      key,
      wave: index + 1,
      date: formatBgDate(key),
      count: members.length,
      partners: members.filter((person) => person.partner).length,
      mirs: countByMir(members),
    }
  })
}

export function countByMir(people: SignedPerson[]) {
  const counts = new Map<string, number>()
  for (const person of people) counts.set(person.mir, (counts.get(person.mir) ?? 0) + 1)
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mir, count]) => ({ mir, count }))
}

/** People of one wave (`YYYY-MM-DD`), or everyone signed so far for 'all'. */
export function peopleInWave(people: SignedPerson[], wave: string) {
  if (wave === 'all') return people
  return people.filter((person) => sofiaDateKey(person.firstSignedAt) === wave)
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

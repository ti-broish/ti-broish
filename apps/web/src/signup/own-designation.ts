import { signupDuplicateSql } from './designation-duplicates'
import { parseStoredNumber } from './designation-number'

/**
 * The signed-in volunteer's own пълномощно on /profil. Only the signed file uploaded by the team
 * (designation_signed_at set, Drive file id) is ever offered: never the unsigned one, never a
 * regenerated one. A rename clears designation_signed_at, so the old signed PDF is not offered
 * while the new one is being signed.
 *
 * The row is found by the session token only: nothing in the URL picks whose file is served.
 */
export const OWN_DESIGNATION_SQL = `SELECT s.id,
    COALESCE(s.withdrawn, 0) AS withdrawn,
    s.designation_number,
    COALESCE(NULLIF(s.designation_mir, ''), substr(COALESCE(s.published_section, ''), 1, 2)) AS mir,
    COALESCE(s.published_section, '') AS section,
    s.designation_signed_at AS signed_at,
    s.designation_first_signed_at AS first_signed_at,
    COALESCE(s.designation_drive_file_id, '') AS drive_file_id,
    COALESCE(s.designation_pdf_url, '') AS pdf_url,
    CASE WHEN ${signupDuplicateSql('s')} THEN 1 ELSE 0 END AS duplicate
  FROM signups s WHERE s.session_token = ?`

export interface OwnDesignationRow {
  id: string
  withdrawn: number | null
  designation_number: number | string | null
  mir: string | null
  section: string | null
  signed_at: string | null
  first_signed_at: string | null
  drive_file_id: string | null
  pdf_url: string | null
  duplicate: number | null
}

/** What the profile card may show. Never carries the Drive id or URL. */
export type OwnDesignation =
  | { state: 'signed'; number: number; mir: string; section: string }
  | { state: 'resigning'; number: number; mir: string; section: string }

const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/

/** Drive file id from the stored id, or from a Drive link (…/file/d/<id>/… or ?id=<id>). */
export function driveFileIdOf(row: Pick<OwnDesignationRow, 'drive_file_id' | 'pdf_url'>): string | null {
  const stored = (row.drive_file_id ?? '').trim()
  if (stored) return DRIVE_ID.test(stored) ? stored : null
  const url = (row.pdf_url ?? '').trim()
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!/(^|\.)google\.com$/.test(parsed.hostname)) return null
  const fromPath = parsed.pathname.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? null
  const id = fromPath ?? parsed.searchParams.get('id')
  return id && DRIVE_ID.test(id) ? id : null
}

/** Signed, numbered, not withdrawn, not a duplicate, and with a Drive file: the only case with a download. */
export function signedDesignationFile(row: OwnDesignationRow | null | undefined): { number: number; fileId: string } | null {
  if (!row) return null
  if (Number(row.withdrawn ?? 0) !== 0) return null
  if (Number(row.duplicate ?? 0) !== 0) return null
  const number = parseStoredNumber(row.designation_number)
  if (number == null) return null
  if (!(row.signed_at ?? '').trim()) return null
  const fileId = driveFileIdOf(row)
  if (!fileId) return null
  return { number, fileId }
}

export function ownDesignation(row: OwnDesignationRow | null | undefined): OwnDesignation | null {
  if (!row) return null
  const mir = (row.mir ?? '').trim()
  const rawSection = (row.section ?? '').trim()
  const section = /^\d{9}$/.test(rawSection) ? rawSection : ''
  const signed = signedDesignationFile(row)
  if (signed) return { state: 'signed', number: signed.number, mir: /^\d{2}$/.test(mir) ? mir : '', section }
  // Signed before, then renamed: the new one is being signed. The old PDF is not offered.
  const number = parseStoredNumber(row.designation_number)
  if (
    number != null &&
    Number(row.withdrawn ?? 0) === 0 &&
    Number(row.duplicate ?? 0) === 0 &&
    !(row.signed_at ?? '').trim() &&
    (row.first_signed_at ?? '').trim()
  ) {
    return { state: 'resigning', number, mir: /^\d{2}$/.test(mir) ? mir : '', section }
  }
  return null
}

/** ASCII only, so every browser keeps it: palnomoshtno-123.pdf */
export function ownDesignationFilename(number: number) {
  return `palnomoshtno-${Math.trunc(number)}.pdf`
}

export function isPdf(bytes: Uint8Array) {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
}

export interface OwnDesignationDb {
  prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } }
}

export interface OwnDesignationPdfDeps {
  token: string | null | undefined
  db: OwnDesignationDb | null
  /** null when Drive credentials are missing. */
  download: ((fileId: string) => Promise<Uint8Array>) | null
}

function text(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}

/**
 * GET /profil/palnomoshtno.pdf: the session's own signed PDF, streamed from Drive.
 * 401 without a session, 404 when there is no signed file for this person.
 */
export async function ownDesignationPdfResponse(deps: OwnDesignationPdfDeps): Promise<Response> {
  const token = (deps.token ?? '').trim()
  if (!token) return text('Влез в профила си.', 401)
  if (!deps.db) return text('Няма база за записванията.', 503)
  const row = await deps.db.prepare(OWN_DESIGNATION_SQL).bind(token).first<OwnDesignationRow>()
  if (!row) return text('Влез в профила си.', 401)
  const file = signedDesignationFile(row)
  if (!file) return text('Няма подписано пълномощно.', 404)
  if (!deps.download) return text('Пълномощното не може да се свали в момента. Опитай след малко.', 503)
  let bytes: Uint8Array
  try {
    bytes = await deps.download(file.fileId)
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    console.warn('own designation download failed', row.id, error instanceof Error ? error.message : error)
    return text('Пълномощното не може да се свали в момента. Опитай след малко.', timedOut ? 504 : 502)
  }
  if (!isPdf(bytes)) {
    console.warn('own designation download: not a PDF', row.id)
    return text('Пълномощното не може да се свали в момента. Опитай след малко.', 502)
  }
  const body = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(body).set(bytes)
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${ownDesignationFilename(file.number)}"`,
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** Each Drive request (token and file) gets its own deadline. */
export const OWN_DESIGNATION_FETCH_TIMEOUT_MS = 10_000

export function fetchWithTimeout(ms: number, fetchImpl: typeof fetch = fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(ms) })) as typeof fetch
}

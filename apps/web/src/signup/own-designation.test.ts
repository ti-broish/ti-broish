import { describe, expect, it, vi } from 'vitest'
import {
  OWN_DESIGNATION_SQL,
  driveFileIdOf,
  fetchWithTimeout,
  ownDesignation,
  ownDesignationFilename,
  ownDesignationPdfResponse,
  signedDesignationFile,
  type OwnDesignationDb,
  type OwnDesignationRow,
} from './own-designation'

const FILE_A = '1AbCdEfGhIjKlMnOpQrStUvWxYz_aaaa'
const FILE_B = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa_bbbb'
const PDF = new TextEncoder().encode('%PDF-1.7\n%signed\n')

function row(patch: Partial<OwnDesignationRow> = {}): OwnDesignationRow {
  return {
    id: 'person-a',
    withdrawn: 0,
    designation_number: 701,
    mir: '23',
    section: '234600123',
    signed_at: '2026-10-21T09:00:00.000Z',
    first_signed_at: '2026-10-21T09:00:00.000Z',
    drive_file_id: FILE_A,
    pdf_url: `https://drive.google.com/file/d/${FILE_A}/view`,
    duplicate: 0,
    ...patch,
  }
}

/** A fake D1 that keys rows by session token, like `WHERE s.session_token = ?`. */
function db(rows: Record<string, OwnDesignationRow>) {
  const calls: { sql: string; values: unknown[] }[] = []
  const fake: OwnDesignationDb = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values })
          return { first: async <T,>() => (rows[String(values[0])] ?? null) as T | null }
        },
      }
    },
  }
  return { fake, calls }
}

describe('own designation eligibility', () => {
  it('a signed, numbered, active row with a Drive file gets the card and the download', () => {
    expect(signedDesignationFile(row())).toEqual({ number: 701, fileId: FILE_A })
    expect(ownDesignation(row())).toEqual({ state: 'signed', number: 701, mir: '23', section: '234600123' })
  })

  it('never for withdrawn, unnumbered, duplicate or missing-file rows', () => {
    expect(ownDesignation(row({ withdrawn: 1 }))).toBeNull()
    expect(ownDesignation(row({ designation_number: null }))).toBeNull()
    expect(ownDesignation(row({ duplicate: 1 }))).toBeNull()
    expect(ownDesignation(row({ drive_file_id: '', pdf_url: '' }))).toBeNull()
    expect(signedDesignationFile(row({ withdrawn: 1 }))).toBeNull()
    expect(signedDesignationFile(null)).toBeNull()
  })

  it('unsigned (never signed): no card, no download, even with a Drive file', () => {
    const unsigned = row({ signed_at: null, first_signed_at: null })
    expect(signedDesignationFile(unsigned)).toBeNull()
    expect(ownDesignation(unsigned)).toBeNull()
  })

  it('renamed and waiting to be re-signed: neutral state, never the stale PDF', () => {
    const renamed = row({ signed_at: null })
    expect(signedDesignationFile(renamed)).toBeNull()
    expect(ownDesignation(renamed)).toEqual({ state: 'resigning', number: 701, mir: '23', section: '234600123' })
    expect(ownDesignation(row({ signed_at: null, withdrawn: 1 }))).toBeNull()
  })

  it('the card never carries the Drive id or link', () => {
    expect(JSON.stringify(ownDesignation(row()))).not.toContain(FILE_A)
    expect(JSON.stringify(ownDesignation(row()))).not.toContain('drive.google')
  })

  it('section only when it is a full 9-digit section; МИР only when 2 digits', () => {
    expect(ownDesignation(row({ section: '' }))).toMatchObject({ section: '' })
    expect(ownDesignation(row({ section: '23' }))).toMatchObject({ section: '' })
    expect(ownDesignation(row({ mir: '' }))).toMatchObject({ mir: '' })
  })

  it('takes the file id from the stored id, else from a Google Drive link only', () => {
    expect(driveFileIdOf({ drive_file_id: FILE_B, pdf_url: '' })).toBe(FILE_B)
    expect(driveFileIdOf({ drive_file_id: '', pdf_url: `https://drive.google.com/file/d/${FILE_B}/view?usp=drivesdk` })).toBe(FILE_B)
    expect(driveFileIdOf({ drive_file_id: '', pdf_url: `https://drive.google.com/open?id=${FILE_B}` })).toBe(FILE_B)
    expect(driveFileIdOf({ drive_file_id: '', pdf_url: `https://evil.example.com/file/d/${FILE_B}/view` })).toBeNull()
    expect(driveFileIdOf({ drive_file_id: '../x?alt=media', pdf_url: '' })).toBeNull()
  })

  it('selects by session token only, never by an id from the request', () => {
    expect(OWN_DESIGNATION_SQL).toMatch(/WHERE s\.session_token = \?$/)
    expect(OWN_DESIGNATION_SQL).toContain('designation_signed_at')
    expect(ownDesignationFilename(701)).toBe('palnomoshtno-701.pdf')
  })
})

describe('GET /profil/palnomoshtno.pdf', () => {
  const rows = {
    'token-a': row(),
    'token-b': row({ id: 'person-b', designation_number: 702, drive_file_id: FILE_B }),
    'token-withdrawn': row({ id: 'person-w', withdrawn: 1 }),
    'token-unsigned': row({ id: 'person-u', signed_at: null, first_signed_at: null }),
    'token-renamed': row({ id: 'person-r', signed_at: null }),
  }

  it('401 when not signed in, without touching D1 or Drive', async () => {
    const download = vi.fn()
    const { fake, calls } = db(rows)
    const response = await ownDesignationPdfResponse({ token: undefined, db: fake, download })
    expect(response.status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(download).not.toHaveBeenCalled()
  })

  it('401 for an unknown session', async () => {
    const download = vi.fn()
    const response = await ownDesignationPdfResponse({ token: 'nope', db: db(rows).fake, download })
    expect(response.status).toBe(401)
    expect(download).not.toHaveBeenCalled()
  })

  it.each(['token-withdrawn', 'token-unsigned', 'token-renamed'])('404 for %s and Drive is never asked', async (token) => {
    const download = vi.fn()
    const response = await ownDesignationPdfResponse({ token, db: db(rows).fake, download })
    expect(response.status).toBe(404)
    expect(download).not.toHaveBeenCalled()
  })

  it("serves only the session's own file, as an attachment that is not cached", async () => {
    const download = vi.fn(async () => PDF)
    const response = await ownDesignationPdfResponse({ token: 'token-a', db: db(rows).fake, download })
    expect(response.status).toBe(200)
    expect(download).toHaveBeenCalledExactlyOnceWith(FILE_A)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="palnomoshtno-701.pdf"')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF)

    const other = vi.fn(async () => PDF)
    await ownDesignationPdfResponse({ token: 'token-b', db: db(rows).fake, download: other })
    expect(other).toHaveBeenCalledExactlyOnceWith(FILE_B)
  })

  it('503 without Drive credentials, 502 on a Drive error or a non-PDF, 504 on a timeout', async () => {
    expect((await ownDesignationPdfResponse({ token: 'token-a', db: db(rows).fake, download: null })).status).toBe(503)
    const failing = async () => {
      throw new Error('Drive 500')
    }
    expect((await ownDesignationPdfResponse({ token: 'token-a', db: db(rows).fake, download: failing })).status).toBe(502)
    const html = async () => new TextEncoder().encode('<html>')
    expect((await ownDesignationPdfResponse({ token: 'token-a', db: db(rows).fake, download: html })).status).toBe(502)
    const timeout = async () => {
      throw new DOMException('timed out', 'TimeoutError')
    }
    const response = await ownDesignationPdfResponse({ token: 'token-a', db: db(rows).fake, download: timeout })
    expect(response.status).toBe(504)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('every Drive request gets its own abort signal', async () => {
    const seen: (AbortSignal | null | undefined)[] = []
    const inner = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal)
      return new Response('ok')
    }) as typeof fetch
    const timed = fetchWithTimeout(50, inner)
    await timed('https://example.com/a', { headers: { a: '1' } })
    await timed('https://example.com/b')
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBeInstanceOf(AbortSignal)
    expect(seen[0]).not.toBe(seen[1])
  })
})

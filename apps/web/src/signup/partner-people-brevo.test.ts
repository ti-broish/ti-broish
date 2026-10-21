// „И аз“ partner people are only for пълномощни: no Brevo path may ever see them.
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { brevoSignupIds, isPartnerPersonId, PARTNER_ID_PREFIX } from './partner-people-sql'

const calls = vi.hoisted(() => ({
  sql: [] as Array<{ sql: string; binds: unknown[] }>,
  syncLinks: [] as unknown[],
  pushLink: [] as unknown[],
  attributes: 0,
}))

vi.mock('cloudflare:workers', () => ({ env: { BREVO_API_KEY: 'test-key' } }))
vi.mock('@tanstack/react-start/server', () => ({ getCookie: () => 'session-token' }))
vi.mock('./admin', () => ({ loadBrevoSectionFieldsForIds: async () => new Map() }))
vi.mock('./brevo', () => ({
  BrevoApiError: class extends Error {},
  readBrevoConfig: () => ({ apiKey: 'test-key', listId: 1 }),
}))
vi.mock('./designation-brevo', () => ({
  designationSectionAttributes: () => ({}),
  fetchBrevoAttributeNames: async () => new Set(['DOCUMENT_URL']),
  fetchBrevoAttributes: async () => {
    calls.attributes += 1
    return {}
  },
  pushDesignationLink: async (input: unknown) => {
    calls.pushLink.push(input)
    return { ok: true }
  },
  syncDesignationLinks: async (input: { contacts: Array<{ personId: string }> }) => {
    calls.syncLinks.push(input)
    return { results: input.contacts.map((contact) => ({ personId: contact.personId, ok: true })) }
  },
}))
vi.mock('./designation-drive-core', () => ({
  createDriveClient: () => ({ uploadPdf: async () => ({ id: 'drive-file', webViewLink: 'https://drive.example/file' }) }),
  designationDriveFolderId: () => 'folder',
  designationHealthMessage: () => '',
  probeDesignationDriveHealth: async () => ({}),
  tryReadDriveAuth: () => ({ ok: true, auth: {} }),
}))

function fakeDb(rows: Record<string, unknown>) {
  return {
    prepare(sql: string) {
      const entry = { sql, binds: [] as unknown[] }
      calls.sql.push(entry)
      const statement = {
        bind(...values: unknown[]) {
          entry.binds = values
          return statement
        },
        async first() {
          if (/FROM signups WHERE session_token/.test(sql)) return { email: 'staff@example.com', email_confirmed: 1 }
          if (/FROM staff/.test(sql)) return { role: 'admin' }
          if (/FROM partner_people WHERE id/.test(sql)) return rows.partner ?? null
          if (/FROM signups WHERE id/.test(sql)) return rows.signup ?? null
          return null
        },
        async all() {
          if (/FROM signups WHERE id IN/.test(sql)) {
            return { results: entry.binds.map((id) => ({ id, email: `${String(id)}@example.com`, url: 'https://drive.example/x' })) }
          }
          return { results: [] }
        },
        async run() {
          return { meta: { changes: 1 } }
        },
      }
      return statement
    },
    async batch() {
      return []
    },
  }
}

let db = fakeDb({})
const dbFailures = vi.hoisted(() => ({ left: 0, message: '' }))
vi.mock('./db-core', () => ({
  SESSION_COOKIE: 'tb_session',
  signupDatabase: async () => {
    if (dbFailures.left > 0) {
      dbFailures.left -= 1
      throw new Error(dbFailures.message)
    }
    return db
  },
}))

const pdf = new TextEncoder().encode('%PDF-1.4 signed')
const partnerRow = {
  id: `${PARTNER_ID_PREFIX}one`,
  email: 'partner@example.com',
  payload: JSON.stringify({ firstName: 'Иван', middleName: 'Петров', lastName: 'Иванов' }),
  published_section: '23',
  designation_number: 501,
  designation_drive_file_id: null,
  designation_pdf_url: null,
}
const signupRow = { ...partnerRow, id: 'signup-one', email: 'signup@example.com', published_section: '234600001' }

beforeEach(() => {
  calls.sql.length = 0
  calls.syncLinks.length = 0
  calls.pushLink.length = 0
  calls.attributes = 0
  dbFailures.left = 0
  db = fakeDb({ partner: partnerRow, signup: signupRow })
})

describe('partner ids', () => {
  it('are told apart from signup ids and dropped before any Brevo call', () => {
    expect(isPartnerPersonId(`${PARTNER_ID_PREFIX}abc`)).toBe(true)
    expect(isPartnerPersonId('7c1f0d5e-0000-4000-8000-000000000000')).toBe(false)
    expect(brevoSignupIds([`${PARTNER_ID_PREFIX}a`, 'b', `${PARTNER_ID_PREFIX}c`])).toEqual(['b'])
  })
})

describe('signed upload to Drive', () => {
  it('stores the link for a partner person and never calls Brevo', async () => {
    const { serveDesignationUpload } = await import('./designation-upload')
    const response = await serveDesignationUpload(
      new Request(`https://x.test/admin/palnomoshtni/upload?personId=${partnerRow.id}`, { method: 'POST', body: pdf }),
    )
    const body = (await response.json()) as { ok: boolean; brevo: { partner?: boolean } }
    expect(body.ok).toBe(true)
    expect(body.brevo.partner).toBe(true)
    expect(calls.pushLink).toHaveLength(0)
    expect(calls.attributes).toBe(0)
    const update = calls.sql.find((entry) => entry.sql.includes('SET designation_pdf_url'))
    expect(update?.sql).toContain('UPDATE partner_people')
  })

  it('still sends the link to Brevo for a signup (control)', async () => {
    const { serveDesignationUpload } = await import('./designation-upload')
    const response = await serveDesignationUpload(
      new Request(`https://x.test/admin/palnomoshtni/upload?personId=${signupRow.id}`, { method: 'POST', body: pdf }),
    )
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true)
    expect(calls.pushLink).toHaveLength(1)
    expect(calls.sql.find((entry) => entry.sql.includes('SET designation_pdf_url'))?.sql).toContain('UPDATE signups')
  })
})

describe('signed upload: idempotent and never a bare HTTPError', () => {
  const uploadUrl = (id: string, extra = '') => `https://x.test/admin/palnomoshtni/upload?personId=${id}${extra}`

  it('skips a person who already has a signed file when the page asks ifMissing=1', async () => {
    db = fakeDb({ partner: { ...partnerRow, designation_drive_file_id: 'old', designation_pdf_url: 'https://drive.example/old' } })
    const { serveDesignationUpload } = await import('./designation-upload')
    const response = await serveDesignationUpload(new Request(uploadUrl(partnerRow.id, '&ifMissing=1'), { method: 'POST', body: pdf }))
    const body = (await response.json()) as { ok: boolean; skipped?: boolean; url?: string }
    expect(body).toMatchObject({ ok: true, skipped: true, url: 'https://drive.example/old' })
    expect(calls.sql.some((entry) => entry.sql.includes('SET designation_pdf_url'))).toBe(false)
  })

  it('still replaces when the page asks to (no ifMissing)', async () => {
    db = fakeDb({ partner: { ...partnerRow, designation_drive_file_id: 'old', designation_pdf_url: 'https://drive.example/old' } })
    const { serveDesignationUpload } = await import('./designation-upload')
    const response = await serveDesignationUpload(new Request(uploadUrl(partnerRow.id), { method: 'POST', body: pdf }))
    expect(((await response.json()) as { ok: boolean; replaced: boolean }).replaced).toBe(true)
  })

  it('rides out one dropped D1 connection in the staff check', async () => {
    dbFailures.left = 1
    dbFailures.message = 'D1_ERROR: Network connection lost.'
    const { serveDesignationUpload } = await import('./designation-upload')
    const response = await serveDesignationUpload(new Request(uploadUrl(partnerRow.id), { method: 'POST', body: pdf }))
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('answers JSON with a Bulgarian reason instead of throwing', async () => {
    dbFailures.left = 1
    dbFailures.message = 'D1_ERROR: no such table: staff'
    const { serveDesignationUpload } = await import('./designation-upload')
    const response = await serveDesignationUpload(new Request(uploadUrl(partnerRow.id), { method: 'POST', body: pdf }))
    expect(response.status).toBe(500)
    const body = (await response.json()) as { ok: boolean; message: string; retryable: boolean }
    expect(body).toMatchObject({ ok: false, retryable: false })
    expect(body.message).toContain('Грешка в базата (D1)')
  })
})

describe('„Синхронизирай с Brevo“', () => {
  it('drops partner people from a per-upload sync', async () => {
    const { handleDesignationSyncBrevo } = await import('./designation-bulk.server')
    const result = await handleDesignationSyncBrevo({ personIds: [partnerRow.id, 'signup-one'], allSigned: false, offset: 0 })
    expect(result.ok).toBe(true)
    const lookup = calls.sql.find((entry) => entry.sql.includes('WHERE id IN'))
    expect(lookup?.binds).toEqual(['signup-one'])
    const synced = (calls.syncLinks[0] as { contacts: Array<{ personId: string }> }).contacts.map((contact) => contact.personId)
    expect(synced).toEqual(['signup-one'])
  })

  it('does nothing when only partner people are asked for', async () => {
    const { handleDesignationSyncBrevo } = await import('./designation-bulk.server')
    const result = await handleDesignationSyncBrevo({ personIds: [partnerRow.id], allSigned: false, offset: 0 })
    expect(result.ok).toBe(false)
    expect(calls.syncLinks).toHaveLength(0)
    expect(calls.sql.some((entry) => entry.sql.includes('WHERE id IN'))).toBe(false)
  })

  it('re-sends all signed links from the signups table only', async () => {
    const { handleDesignationSyncBrevo } = await import('./designation-bulk.server')
    await handleDesignationSyncBrevo({ personIds: [], allSigned: true, offset: 0 })
    const reads = calls.sql.filter((entry) => entry.sql.includes('designation_pdf_url'))
    expect(reads.length).toBeGreaterThan(0)
    for (const entry of reads) {
      expect(entry.sql).toContain('FROM signups')
      expect(entry.sql).not.toContain('partner_people')
    }
  })
})

describe('every other Brevo path reads signups only', () => {
  // Секции direct sync, campaigns, contact pushes and the Brevo CSV exports.
  const files = [
    'admin-brevo.ts',
    'brevo.ts',
    'brevo-sync.ts',
    'brevo-campaign.ts',
    'brevo-contact.ts',
    'brevo-lists.ts',
    'brevo-sections-export.ts',
    'designation-brevo.ts',
    'admin-csv.ts',
  ]
  it.each(files)('%s never touches partner_people', (file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    expect(source).not.toMatch(/partner_people|partner-people-sql|partner-import/)
  })
})

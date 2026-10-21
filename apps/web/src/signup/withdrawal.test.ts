import { describe, expect, it, vi } from 'vitest'
import { BREVO_CLEANED_MARK, type BrevoListOutcome } from './admin-unregister'
import { cleanupWithdrawnContact, type BrevoConfig } from './brevo'
import type { SignupD1 } from './db-core'
import { brevoWithdrawCleanup, cleanupWithdrawnBrevo, releaseWithdrawnSections, restoreSignup, withdrawalTurn, withdrawSignup } from './withdrawal'

vi.mock('cloudflare:workers', () => ({ env: {} }))

type Raw = { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): { changes: number | bigint }; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } }

async function openDb(): Promise<{ raw: Raw; db: SignupD1 } | null> {
  let raw: Raw
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Raw }
    raw = new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
  raw.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, email TEXT, payload TEXT, withdrawn INTEGER DEFAULT 0, withdrawn_at TEXT, withdrawn_by TEXT,
    withdrawn_reason TEXT, withdrawn_note TEXT, withdrawal_processed_at TEXT, withdrawal_processed_by TEXT, draft_section TEXT, draft_locked INTEGER DEFAULT 0, published_section TEXT, published_at TEXT,
    designation_number INTEGER, designation_pdf_url TEXT, updated_at TEXT)`)
  raw.exec(`CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT, actor TEXT, field TEXT, before_text TEXT, after_text TEXT, created_at TEXT)`)
  const statement = (sql: string, binds: unknown[] = []): ReturnType<SignupD1['prepare']> => ({
    bind: (...values: unknown[]) => statement(sql, values.map((value) => (typeof value === 'boolean' ? Number(value) : value))),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...binds).changes) } }),
    first: async <T,>() => (raw.prepare(sql).get(...binds) as T) ?? null,
    all: async <T,>() => ({ results: raw.prepare(sql).all(...binds) as T[] }),
  })
  return { raw, db: { prepare: (sql: string) => statement(sql), batch: async () => [] } }
}

function seed(raw: Raw, id: string, withdrawn: number, section: string | null, updatedAt = '2026-10-20T10:35:28.382Z') {
  raw
    .prepare(`INSERT INTO signups (id, email, payload, withdrawn, draft_section, draft_locked, published_section, published_at, designation_number, updated_at)
      VALUES (?, ?, '{"withdrawn":false}', ?, ?, 1, ?, ?, 501, ?)`)
    .run(id, `${id}@example.com`, withdrawn, section, section, section ? '2026-10-19T12:18:51.592Z' : null, updatedAt)
}

const cleaned: BrevoListOutcome = { ok: true, action: 'removed', detail: 'изчистен, махнат от списъци 95, 101, полетата за секция са празни' }

describe('withdrawSignup (self and admin share it)', () => {
  it('self-withdraw frees the seat, keeps the пълномощно, writes audit with the Brevo outcome', async () => {
    const open = await openDb()
    if (!open) return
    seed(open.raw, 'a', 0, '182600013')
    const brevo = vi.fn(async () => cleaned)
    const result = await withdrawSignup(
      open.db,
      { id: 'a', email: 'a@example.com', draft_section: '182600013', published_section: '182600013' },
      { actor: 'a@example.com', by: 'self', reason: 'self', note: '', byAdmin: false },
      '2026-10-20T11:00:00.000Z',
      brevo,
    )
    expect(result.updated).toBe(true)
    expect(brevo).toHaveBeenCalledWith('a@example.com')
    const row = open.raw.prepare('SELECT * FROM signups WHERE id = ?').get('a') as Record<string, unknown>
    expect(row).toMatchObject({ withdrawn: 1, withdrawn_by: 'self', withdrawn_reason: 'self', withdrawn_at: '2026-10-20T11:00:00.000Z', draft_section: null, published_section: null, published_at: null, draft_locked: 0, designation_number: 501 })
    expect(JSON.parse(String(row.payload))).toMatchObject({ withdrawn: true, withdrawnByAdmin: false, assignedSection: null })
    const audit = open.raw.prepare('SELECT * FROM signup_audit').all() as Array<Record<string, string>>
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ field: 'withdrawn', actor: 'a@example.com', before_text: 'Активен · публикувана 182600013' })
    expect(audit[0]!.after_text).toBe(`Отписан · Оттегли се от профила · освободена публикувана 182600013 · ${BREVO_CLEANED_MARK}, махнат от списъци 95, 101, полетата за секция са празни`)
    // Second call: already withdrawn, nothing happens.
    expect((await withdrawSignup(open.db, { id: 'a', email: 'a@example.com', draft_section: '', published_section: '' }, { actor: 'x', by: 'self', reason: 'self', note: '', byAdmin: false }, 'later', brevo)).updated).toBe(false)
    expect(brevo).toHaveBeenCalledTimes(1)
  })

  it('a Brevo failure does not block the withdrawal and lands in the audit', async () => {
    const open = await openDb()
    if (!open) return
    seed(open.raw, 'b', 0, '234600101')
    const result = await withdrawSignup(
      open.db,
      { id: 'b', email: 'b@example.com', draft_section: '234600101', published_section: '234600101' },
      { actor: 'admin@example.com', by: 'admin@example.com', reason: 'call_quit', note: '', byAdmin: true },
      'now',
      async () => ({ ok: false, action: 'removed', detail: 'Brevo HTTP 500' }),
    )
    expect(result.updated).toBe(true)
    expect(open.raw.prepare('SELECT published_section FROM signups').get()).toMatchObject({ published_section: null })
    expect((open.raw.prepare('SELECT after_text FROM signup_audit').get() as { after_text: string }).after_text).toContain('Brevo (неуспех): Brevo HTTP 500')
  })

  it('restore clears the withdrawal and does not bring the seat back', async () => {
    const open = await openDb()
    if (!open) return
    seed(open.raw, 'c', 0, '182600013')
    await withdrawSignup(open.db, { id: 'c', email: 'c@example.com', draft_section: '182600013', published_section: '182600013' }, { actor: 'c@example.com', by: 'self', reason: 'self', note: '', byAdmin: false }, 't1', async () => cleaned)
    const restored = await restoreSignup(open.db, { id: 'c', email: 'c@example.com', withdrawn_reason: 'self', withdrawn_note: '' }, 'c@example.com', 't2', { firstName: 'C', lastName: 'D' })
    expect(restored).toMatchObject({ updated: true, previousSection: '182600013' })
    expect(open.raw.prepare('SELECT withdrawn, withdrawn_at, withdrawn_by, published_section FROM signups').get()).toMatchObject({ withdrawn: 0, withdrawn_at: null, withdrawn_by: null, published_section: null })
  })
})

describe('withdrawalTurn', () => {
  it('flags only real transitions', () => {
    expect(withdrawalTurn(0, 1)).toBe('withdraw')
    expect(withdrawalTurn(1, 0)).toBe('return')
    expect(withdrawalTurn(1, 1)).toBeNull()
    expect(withdrawalTurn(0, 0)).toBeNull()
  })
})

describe('backfill: withdrawn people who still hold a seat', () => {
  it('frees the seat once, dates the withdrawal from the self-withdraw save, and leaves others alone', async () => {
    const open = await openDb()
    if (!open) return
    seed(open.raw, 'osenets', 1, '182600013')
    seed(open.raw, 'active', 0, '182600014')
    seed(open.raw, 'done', 1, null)
    open.raw.prepare(`UPDATE signups SET withdrawn_at = '2026-10-20T09:39:36.526Z', withdrawn_by = 'admin@example.com', withdrawn_reason = 'sik_member' WHERE id = 'done'`).run()
    const brevo = vi.fn(async () => cleaned)
    expect(await releaseWithdrawnSections(open.db, '2026-10-20T12:00:00.000Z', brevo)).toEqual({ released: 1 })
    expect(open.raw.prepare(`SELECT * FROM signups WHERE id = 'osenets'`).get()).toMatchObject({
      withdrawn: 1,
      withdrawn_at: '2026-10-20T10:35:28.382Z',
      withdrawn_by: 'self',
      withdrawn_reason: 'self',
      draft_section: null,
      published_section: null,
      published_at: null,
      draft_locked: 0,
      designation_number: 501,
    })
    expect(open.raw.prepare(`SELECT published_section FROM signups WHERE id = 'active'`).get()).toMatchObject({ published_section: '182600014' })
    expect(open.raw.prepare(`SELECT withdrawn_by FROM signups WHERE id = 'done'`).get()).toMatchObject({ withdrawn_by: 'admin@example.com' })
    const audit = open.raw.prepare('SELECT actor, before_text, after_text FROM signup_audit').all() as Array<Record<string, string>>
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor: 'system', before_text: 'Оттеглен, но държи секция · публикувана 182600013' })
    expect(audit[0]!.after_text).toContain('освободена публикувана 182600013')
    expect(brevo).toHaveBeenCalledWith('osenets@example.com')
    expect(await releaseWithdrawnSections(open.db, 'later', brevo)).toEqual({ released: 0 })
    expect(brevo).toHaveBeenCalledTimes(1)
  })

  it('Brevo cleanup visits withdrawn people until each is clean, then stops', async () => {
    const open = await openDb()
    if (!open) return
    seed(open.raw, 'k', 1, null)
    seed(open.raw, 'm', 1, null)
    seed(open.raw, 'active', 0, null)
    const outcomes: Record<string, BrevoListOutcome> = {
      'k@example.com': cleaned,
      'm@example.com': { ok: false, action: 'removed', detail: 'Brevo HTTP 500' },
    }
    const brevo = vi.fn(async (email: string) => outcomes[email]!)
    expect(await cleanupWithdrawnBrevo(open.db, 'admin@example.com', 'now', brevo)).toEqual({ checked: 2, cleaned: 1, failed: 1, left: 1 })
    outcomes['m@example.com'] = { ok: true, action: 'skipped', detail: 'изчистен, няма такъв контакт' }
    expect(await cleanupWithdrawnBrevo(open.db, 'admin@example.com', 'now2', brevo)).toEqual({ checked: 1, cleaned: 1, failed: 0, left: 0 })
    expect(await cleanupWithdrawnBrevo(open.db, 'admin@example.com', 'now3', brevo)).toEqual({ checked: 0, cleaned: 0, failed: 0, left: 0 })
    expect(brevo).toHaveBeenCalledTimes(3)
    expect(brevo).not.toHaveBeenCalledWith('active@example.com')
  })
})

describe('„Почисти наново“: withdrawn people the old resync put back on the Brevo list', () => {
  it('re-cleans withdrawn people with a signed link once per run, even when they were cleaned before; never the active or unsigned', async () => {
    const open = await openDb()
    if (!open) return
    for (const id of ['w1', 'w2', 'w3']) seed(open.raw, id, 1, null)
    seed(open.raw, 'wnolink', 1, null)
    seed(open.raw, 'active', 0, '182600013')
    open.raw.exec(`UPDATE signups SET designation_pdf_url = 'https://drive.example/' || id, withdrawn_at = '2026-10-20T10:00:00.000Z' WHERE id IN ('w1','w2','w3','active')`)
    open.raw.exec(`UPDATE signups SET withdrawn_at = '2026-10-20T10:00:00.000Z' WHERE id = 'wnolink'`)
    // Their withdrawal cleanup already ran (so the plain cleanup skips them), then the old resync re-added them.
    for (const id of ['w1', 'w2', 'w3', 'wnolink']) {
      open.raw.prepare(`INSERT INTO signup_audit VALUES (?, ?, 'admin', 'withdrawn', '', ?, '2026-10-20T10:00:00.000Z')`).run(`a-${id}`, id, `Отписан ${BREVO_CLEANED_MARK}`)
    }
    const brevo = vi.fn(async (_email: string) => cleaned)
    expect(await cleanupWithdrawnBrevo(open.db, 'admin@example.com', '2026-10-21T11:00:00.000Z', brevo)).toEqual({ checked: 0, cleaned: 0, failed: 0, left: 0 })

    const since = '2026-10-21T11:00:00.000Z'
    expect(await cleanupWithdrawnBrevo(open.db, 'admin@example.com', '2026-10-21T11:00:01.000Z', brevo, 2, { since })).toEqual({ checked: 2, cleaned: 2, failed: 0, left: 1 })
    expect(await cleanupWithdrawnBrevo(open.db, 'admin@example.com', '2026-10-21T11:00:02.000Z', brevo, 2, { since })).toEqual({ checked: 1, cleaned: 1, failed: 0, left: 0 })
    // Same run again: nothing left, nothing called (idempotent).
    expect(await cleanupWithdrawnBrevo(open.db, 'admin@example.com', '2026-10-21T11:00:03.000Z', brevo, 2, { since })).toEqual({ checked: 0, cleaned: 0, failed: 0, left: 0 })
    expect(brevo.mock.calls.map(([email]) => email).sort()).toEqual(['w1@example.com', 'w2@example.com', 'w3@example.com'])
    const audit = open.raw.prepare(`SELECT after_text FROM signup_audit WHERE field = 'brevo_cleanup'`).all() as Array<{ after_text: string }>
    expect(audit).toHaveLength(3)
    for (const row of audit) expect(row.after_text.startsWith('Почистване наново')).toBe(true)
  })

  it('a failed re-clean stays in the run until it is clean', async () => {
    const open = await openDb()
    if (!open) return
    seed(open.raw, 'w1', 1, null)
    open.raw.exec(`UPDATE signups SET designation_pdf_url = 'https://drive.example/w1' WHERE id = 'w1'`)
    const since = '2026-10-21T11:00:00.000Z'
    const failing = vi.fn(async (_email: string): Promise<BrevoListOutcome> => ({ ok: false, action: 'removed', detail: 'Brevo HTTP 500' }))
    expect(await cleanupWithdrawnBrevo(open.db, 'admin', '2026-10-21T11:00:01.000Z', failing, 25, { since })).toEqual({ checked: 1, cleaned: 0, failed: 1, left: 1 })
    expect(await cleanupWithdrawnBrevo(open.db, 'admin', '2026-10-21T11:00:02.000Z', vi.fn(async () => cleaned), 25, { since })).toEqual({ checked: 1, cleaned: 1, failed: 0, left: 0 })
  })
})

describe('Brevo cleanup of a withdrawn contact', () => {
  const config: BrevoConfig = { apiKey: 'k', listId: 95, templateId: null, senderEmail: 's@example.com', senderName: 'S' }

  it('unlinks every list the contact is on, then blanks the section attributes; never sends', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ email: 'a@example.com', listIds: [101, 95, 95] }), { status: 200 })
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    const result = await cleanupWithdrawnContact(config, ' A@Example.com ', fetchImpl)
    expect(result).toEqual({ found: true, lists: [95, 101], attributes: 'cleared' })
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://api.brevo.com/v3/contacts/a%40example.com',
      'PUT https://api.brevo.com/v3/contacts/a%40example.com',
      'PUT https://api.brevo.com/v3/contacts/a%40example.com',
    ])
    expect(calls[1]!.body).toEqual({ unlinkListIds: [95, 101] })
    expect(calls[2]!.body).toEqual({ attributes: { SECTION_PUBLISHED: false, SECTION_CODE: '', SECTION_ID_TEXT: '', SECTION_ADDRESS: '', SECTION_PLACE: '' } })
    expect(calls.some((call) => /smtp|emailCampaigns|sendNow/.test(call.url))).toBe(false)
  })

  it('a missing contact is clean; an error is reported, not thrown', async () => {
    const missing = vi.fn(async () => new Response(JSON.stringify({ code: 'document_not_found', message: 'Contact does not exist' }), { status: 404 })) as unknown as typeof fetch
    expect(await brevoWithdrawCleanup('x@example.com', () => config, missing)).toEqual({ ok: true, action: 'skipped', detail: 'изчистен, няма такъв контакт' })
    const broken = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    const outcome = await brevoWithdrawCleanup('x@example.com', () => config, broken)
    expect(outcome.ok).toBe(false)
    expect(await brevoWithdrawCleanup('x@example.com', () => ({ missing: 'BREVO_API_KEY' }), broken)).toEqual({ ok: true, action: 'skipped', detail: 'липсва BREVO_API_KEY' })
  })
})

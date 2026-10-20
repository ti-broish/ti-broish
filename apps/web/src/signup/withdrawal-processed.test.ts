import { describe, expect, it, vi } from 'vitest'
import {
  markWithdrawalProcessedSql,
  parseWithdrawnProcessed,
  processedAuditAfter,
  processedAuditBefore,
  processedMessage,
  restoreSql,
  unmarkWithdrawalProcessedSql,
  WITHDRAWN_PROCESSED_OPTIONS,
  withdrawnCountsFrom,
  withdrawnCountsLine,
  withdrawnProcessedClause,
} from './admin-unregister'
import { rosterWhere } from './admin-csv'
import { auditLines, describeAudit } from './admin-audit'
import { parseSignupSearch } from './admin-search'
import type { SignupD1 } from './db-core'
import { restoreSignup, setWithdrawalProcessed, withdrawnCounts } from './withdrawal'

vi.mock('cloudflare:workers', () => ({ env: {} }))

describe('Отписани → обработен (pure)', () => {
  it('parses the URL filter and keeps it only on the Отписани view', () => {
    expect(parseWithdrawnProcessed('yes')).toBe('yes')
    expect(parseWithdrawnProcessed('no')).toBe('no')
    expect(parseWithdrawnProcessed('all')).toBeUndefined()
    expect(parseWithdrawnProcessed(1)).toBeUndefined()
    expect(parseSignupSearch({ view: 'withdrawn', processed: 'no' })).toMatchObject({ view: 'withdrawn', processed: 'no' })
    expect(parseSignupSearch({ view: 'withdrawn', processed: 'yes' }).processed).toBe('yes')
    expect('processed' in parseSignupSearch({ view: 'withdrawn' })).toBe(false)
    expect('processed' in parseSignupSearch({ view: 'withdrawn', processed: 'maybe' })).toBe(false)
    expect('processed' in parseSignupSearch({ view: 'all', processed: 'yes' })).toBe(false)
    expect(WITHDRAWN_PROCESSED_OPTIONS.map(([, label]) => label)).toEqual(['Всички отписани', 'Обработени', 'Необработени'])
  })

  it('narrows only the withdrawn view', () => {
    expect(withdrawnProcessedClause('withdrawn', undefined)).toBe('')
    expect(withdrawnProcessedClause('all', 'yes')).toBe('')
    expect(withdrawnProcessedClause('withdrawn', 'yes')).toBe(" AND COALESCE(withdrawal_processed_at, '') != ''")
    expect(withdrawnProcessedClause('withdrawn', 'no')).toBe(" AND NOT (COALESCE(withdrawal_processed_at, '') != '')")
  })

  it('mark/unmark SQL only touches withdrawn rows; restore clears the mark', () => {
    expect(markWithdrawalProcessedSql()).toContain('COALESCE(withdrawn, 0) = 1')
    expect(unmarkWithdrawalProcessedSql()).toContain('withdrawal_processed_by = NULL')
    expect(restoreSql()).toContain('withdrawal_processed_at = NULL')
    expect(markWithdrawalProcessedSql()).not.toMatch(/section|designation/)
    expect(unmarkWithdrawalProcessedSql()).not.toMatch(/section|designation/)
  })

  it('counts line and audit copy', () => {
    const counts = withdrawnCountsFrom({ total: 7, processed: 3 })
    expect(counts).toEqual({ total: 7, processed: 3, unprocessed: 4 })
    expect(withdrawnCountsLine(counts)).toBe('Отписани: 7 · обработени 3 · необработени 4')
    expect(withdrawnCountsFrom(null)).toEqual({ total: 0, processed: 0, unprocessed: 0 })
    expect([processedAuditBefore(true), processedAuditAfter(true)]).toEqual(['Необработен', 'Обработен'])
    expect([processedAuditBefore(false), processedAuditAfter(false)]).toEqual(['Обработен', 'Необработен'])
    expect(describeAudit('withdrawal_processed', 'Необработен', 'Обработен')).toBe('Отписан: Необработен → Обработен')
    expect(
      auditLines([{ id: '1', actor: 'admin@example.com', field: 'withdrawal_processed', before_text: 'Необработен', after_text: 'Обработен', created_at: 'now' }]),
    ).toHaveLength(1)
    expect(processedMessage(true, true)).toBe('Отбелязахме го като обработен.')
    expect(processedMessage(false, false)).toBe('Не е отбелязан като обработен.')
  })
})

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
    withdrawn_reason TEXT, withdrawn_note TEXT, withdrawal_processed_at TEXT, withdrawal_processed_by TEXT, draft_section TEXT, draft_locked INTEGER DEFAULT 0,
    published_section TEXT, published_at TEXT, mir_code TEXT, region_code TEXT, submitted INTEGER DEFAULT 1, updated_at TEXT)`)
  raw.exec(`CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT, actor TEXT, field TEXT, before_text TEXT, after_text TEXT, created_at TEXT)`)
  const statement = (sql: string, binds: unknown[] = []): ReturnType<SignupD1['prepare']> => ({
    bind: (...values: unknown[]) => statement(sql, values.map((value) => (typeof value === 'boolean' ? Number(value) : value))),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...binds).changes) } }),
    first: async <T,>() => (raw.prepare(sql).get(...binds) as T) ?? null,
    all: async <T,>() => ({ results: raw.prepare(sql).all(...binds) as T[] }),
  })
  return { raw, db: { prepare: (sql: string) => statement(sql), batch: async () => [] } }
}

function seed(raw: Raw, id: string, withdrawn: number, section: string | null = null) {
  raw
    .prepare(`INSERT INTO signups (id, email, payload, withdrawn, withdrawn_at, withdrawn_by, draft_section, published_section, updated_at)
      VALUES (?, ?, '{}', ?, ?, ?, ?, ?, '2026-10-20T10:00:00.000Z')`)
    .run(id, `${id}@example.com`, withdrawn, withdrawn ? '2026-10-20T09:00:00.000Z' : null, withdrawn ? 'self' : null, section, section)
}

function idsWhere(raw: Raw, processed: 'yes' | 'no' | undefined) {
  const filter = rosterWhere('withdrawn', '')
  if ('error' in filter) throw new Error(filter.error)
  return (raw.prepare(`SELECT id FROM signups WHERE (${filter.clause})${withdrawnProcessedClause('withdrawn', processed)} ORDER BY id`).all() as Array<{ id: string }>).map(
    (row) => row.id,
  )
}

describe('setWithdrawalProcessed (integration, node:sqlite)', () => {
  it('marks, unmarks, writes one audit row per change, and leaves sections alone', async () => {
    const open = await openDb()
    if (!open) return
    seed(open.raw, 'w1', 1)
    seed(open.raw, 'a1', 0, '234600101')

    expect(await setWithdrawalProcessed(open.db, 'w1', true, 'admin@example.com', '2026-10-20T12:00:00.000Z')).toEqual({ updated: true })
    expect(open.raw.prepare('SELECT withdrawn, withdrawal_processed_at, withdrawal_processed_by, updated_at FROM signups WHERE id = ?').get('w1')).toMatchObject({
      withdrawn: 1,
      withdrawal_processed_at: '2026-10-20T12:00:00.000Z',
      withdrawal_processed_by: 'admin@example.com',
      updated_at: '2026-10-20T12:00:00.000Z',
    })
    // Marking twice is a no-op with no second audit row.
    expect(await setWithdrawalProcessed(open.db, 'w1', true, 'other@example.com', 'later')).toEqual({ updated: false })
    // An active person cannot be marked.
    expect(await setWithdrawalProcessed(open.db, 'a1', true, 'admin@example.com', 'later')).toEqual({ updated: false })
    expect(open.raw.prepare('SELECT published_section, withdrawal_processed_at FROM signups WHERE id = ?').get('a1')).toMatchObject({
      published_section: '234600101',
      withdrawal_processed_at: null,
    })

    expect(await setWithdrawalProcessed(open.db, 'w1', false, 'admin@example.com', '2026-10-20T12:05:00.000Z')).toEqual({ updated: true })
    expect(open.raw.prepare('SELECT withdrawal_processed_at, withdrawal_processed_by FROM signups WHERE id = ?').get('w1')).toMatchObject({
      withdrawal_processed_at: null,
      withdrawal_processed_by: null,
    })
    expect(await setWithdrawalProcessed(open.db, 'w1', false, 'admin@example.com', 'later')).toEqual({ updated: false })

    const audit = open.raw.prepare('SELECT signup_id, actor, field, before_text, after_text, created_at FROM signup_audit ORDER BY created_at').all()
    expect(audit).toEqual([
      { signup_id: 'w1', actor: 'admin@example.com', field: 'withdrawal_processed', before_text: 'Необработен', after_text: 'Обработен', created_at: '2026-10-20T12:00:00.000Z' },
      { signup_id: 'w1', actor: 'admin@example.com', field: 'withdrawal_processed', before_text: 'Обработен', after_text: 'Необработен', created_at: '2026-10-20T12:05:00.000Z' },
    ])
  })

  it('filters всички / обработени / необработени and counts them', async () => {
    const open = await openDb()
    if (!open) return
    for (const id of ['w1', 'w2', 'w3', 'w4']) seed(open.raw, id, 1)
    seed(open.raw, 'a1', 0)
    expect(await withdrawnCounts(open.db)).toEqual({ total: 4, processed: 0, unprocessed: 4 })
    await setWithdrawalProcessed(open.db, 'w2', true, 'admin@example.com', 'now')
    await setWithdrawalProcessed(open.db, 'w4', true, 'admin@example.com', 'now')
    expect(idsWhere(open.raw, undefined)).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(idsWhere(open.raw, 'yes')).toEqual(['w2', 'w4'])
    expect(idsWhere(open.raw, 'no')).toEqual(['w1', 'w3'])
    expect(await withdrawnCounts(open.db)).toEqual({ total: 4, processed: 2, unprocessed: 2 })
    await setWithdrawalProcessed(open.db, 'w4', false, 'admin@example.com', 'later')
    expect(await withdrawnCounts(open.db)).toEqual({ total: 4, processed: 1, unprocessed: 3 })
  })

  it('restoring a processed person clears the mark, so a new withdrawal starts unprocessed', async () => {
    const open = await openDb()
    if (!open) return
    seed(open.raw, 'w1', 1)
    await setWithdrawalProcessed(open.db, 'w1', true, 'admin@example.com', 'now')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    try {
      const restored = await restoreSignup(open.db, { id: 'w1', email: 'w1@example.com', withdrawn_reason: '', withdrawn_note: '' }, 'admin@example.com', 'later', {
        firstName: '',
        lastName: '',
      })
      expect(restored.updated).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(open.raw.prepare('SELECT withdrawn, withdrawal_processed_at, withdrawal_processed_by FROM signups WHERE id = ?').get('w1')).toMatchObject({
      withdrawn: 0,
      withdrawal_processed_at: null,
      withdrawal_processed_by: null,
    })
    expect(await withdrawnCounts(open.db)).toEqual({ total: 0, processed: 0, unprocessed: 0 })
  })
})

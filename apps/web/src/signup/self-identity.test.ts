import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { SignupD1 } from './db-core'
import {
  applyIdentityFix,
  checkIdentityFix,
  hasDesignationDocument,
  holdSelfIdentity,
  loadStoredIdentity,
  recordSelfIdentityChange,
  requestedSelfIdentity,
  selfTaskDetail,
} from './identity-fix'
import { SELF_CHANGE_CONFIRM } from './self-identity'
import { TASK_LABELS } from './rik/match'

vi.mock('cloudflare:workers', () => ({ env: {} }))

/** A valid ЕГН for a date (born 1990-1999): checksum digit computed. */
function egn(prefix9: string) {
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = prefix9.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index]!, 0)
  const check = sum % 11 === 10 ? 0 : sum % 11
  return `${prefix9}${check}`
}

const OLD_EGN = egn('900101123')
const NEW_EGN = egn('910202456')

type Raw = { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): { changes: number | bigint }; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } }

async function openDb(): Promise<{ raw: Raw; db: SignupD1 } | null> {
  let raw: Raw
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Raw }
    raw = new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
  const designation = `designation_number INTEGER, designation_mir TEXT, designation_generated_at TEXT, designation_signing_generated_at TEXT,
    designation_signed_at TEXT, designation_first_signed_at TEXT, designation_drive_file_id TEXT, designation_pdf_url TEXT, updated_at TEXT`
  raw.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, email TEXT, payload TEXT, egn TEXT, withdrawn INTEGER DEFAULT 0, ${designation})`)
  raw.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, partner TEXT, email TEXT, egn TEXT, first_name TEXT, middle_name TEXT, last_name TEXT,
    withdrawn_at TEXT, ${designation}, UNIQUE (partner, egn))`)
  raw.exec(`CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT, actor TEXT, field TEXT, before_text TEXT, after_text TEXT, created_at TEXT)`)
  raw.exec(`CREATE TABLE rik_sources (mir TEXT PRIMARY KEY, submitted_at TEXT)`)
  raw.exec(`CREATE TABLE rik_entries (id TEXT PRIMARY KEY, mir TEXT, ours INTEGER, number INTEGER, missing_since TEXT)`)
  raw.exec(`CREATE TABLE rik_status (person_id TEXT PRIMARY KEY, status TEXT)`)
  raw.exec(`CREATE TABLE rik_tasks (id TEXT PRIMARY KEY, person_id TEXT, mir TEXT NOT NULL, type TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT, done_by TEXT, fixed_at TEXT, fixed_by TEXT, old_name TEXT, old_egn TEXT)`)
  const statement = (sql: string, binds: unknown[] = []): ReturnType<SignupD1['prepare']> & { exec(): unknown } => ({
    bind: (...values: unknown[]) => statement(sql, values),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...binds).changes) } }),
    first: async <T,>() => (raw.prepare(sql).get(...binds) as T) ?? null,
    all: async <T,>() => ({ results: raw.prepare(sql).all(...binds) as T[] }),
    exec: () => raw.prepare(sql).run(...binds),
  })
  const db: SignupD1 = {
    prepare: (sql: string) => statement(sql),
    // D1 batches are one transaction: all or nothing.
    batch: async (statements) => {
      raw.exec('BEGIN')
      try {
        for (const item of statements) (item as unknown as { exec(): unknown }).exec()
        raw.exec('COMMIT')
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
      return []
    },
  }
  return { raw, db }
}

const SIGNED = {
  designation_number: 7,
  designation_mir: '23',
  designation_generated_at: '2026-10-21T08:00:00.000Z',
  designation_signing_generated_at: '2026-10-21T09:00:00.000Z',
  designation_signed_at: '2026-10-21T12:00:00.000Z',
  designation_first_signed_at: '2026-10-21T12:00:00.000Z',
  designation_drive_file_id: 'file-old',
  designation_pdf_url: 'https://drive.google.com/file/d/file-old/view',
}

function seedSignup(raw: Raw, id: string, overrides: Partial<typeof SIGNED> = {}) {
  const row = { ...SIGNED, ...overrides }
  raw
    .prepare(`INSERT INTO signups (id, email, payload, egn, designation_number, designation_mir, designation_generated_at, designation_signing_generated_at,
      designation_signed_at, designation_first_signed_at, designation_drive_file_id, designation_pdf_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      `${id}@example.com`,
      JSON.stringify({ firstName: 'Иван', middleName: 'Петров', lastName: 'Иванов', phone: '0888' }),
      OLD_EGN,
      row.designation_number,
      row.designation_mir,
      row.designation_generated_at,
      row.designation_signing_generated_at,
      row.designation_signed_at,
      row.designation_first_signed_at,
      row.designation_drive_file_id,
      row.designation_pdf_url,
    )
}


const NAMES = { firstName: 'Иван', middleName: 'Петров', lastName: 'Иванов' }

describe('self-service names/ЕГН: hold back and confirm', () => {
  it('holds only for a non-withdrawn person with a document, and only when names or ЕГН change', async () => {
    const open = await openDb()
    if (!open) return
    seedSignup(open.raw, 'a')
    seedSignup(open.raw, 'fresh', { designation_generated_at: null as never, designation_signing_generated_at: null as never, designation_signed_at: null as never, designation_first_signed_at: null as never, designation_drive_file_id: null as never, designation_pdf_url: null as never })
    seedSignup(open.raw, 'none', { designation_number: null as never })
    seedSignup(open.raw, 'gone')
    open.raw.prepare(`UPDATE signups SET withdrawn = 1 WHERE id = 'gone'`).run()
    const a = (await loadStoredIdentity(open.db, 'signups', 'a'))!
    expect(hasDesignationDocument(a.file)).toBe(true)
    // Same data (spacing aside), empty ЕГН keeps the stored: no hold.
    expect(holdSelfIdentity(a, requestedSelfIdentity(a, { ...NAMES, firstName: ' Иван ', egn: '' }))).toBe(false)
    expect(holdSelfIdentity(a, requestedSelfIdentity(a, { ...NAMES, lastName: 'Иванова', egn: '' }))).toBe(true)
    expect(holdSelfIdentity(a, requestedSelfIdentity(a, { ...NAMES, egn: NEW_EGN }))).toBe(true)
    for (const id of ['fresh', 'none', 'gone']) {
      const stored = (await loadStoredIdentity(open.db, 'signups', id))!
      expect(holdSelfIdentity(stored, requestedSelfIdentity(stored, { ...NAMES, lastName: 'Иванова', egn: NEW_EGN }))).toBe(false)
    }
    expect(SELF_CHANGE_CONFIRM).toBe('Сигурни ли сте? Ще трябва да издадем ново пълномощно и да коригираме данните в РИК.')
    expect(TASK_LABELS.self_identity).toBe('Смяна име/ЕГН – нов документ')
  })

  it('confirm: saves with audit and opens one РИК task with old and new values (ЕГН masked); the document is not reset', async () => {
    const open = await openDb()
    if (!open) return
    seedSignup(open.raw, 'a')
    const stored = (await loadStoredIdentity(open.db, 'signups', 'a'))!
    const check = checkIdentityFix({ ...NAMES, lastName: 'Иванова', egn: NEW_EGN }, { ...stored.names, egn: stored.egn })
    if (!check.ok) throw new Error(check.message)
    const now = '2026-10-23T11:00:00.000Z'
    const { taskId } = await recordSelfIdentityChange(open.db, { stored, after: check.after, actor: 'a@example.com (сам)', now })
    const row = open.raw.prepare('SELECT * FROM signups WHERE id = ?').get('a') as Record<string, unknown>
    expect(JSON.parse(String(row.payload))).toMatchObject({ lastName: 'Иванова', phone: '0888' })
    expect(row).toMatchObject({ egn: NEW_EGN, designation_signed_at: SIGNED.designation_signed_at, designation_drive_file_id: 'file-old' })
    const audit = open.raw.prepare('SELECT field, actor FROM signup_audit ORDER BY field').all() as Array<Record<string, string>>
    expect(audit).toEqual([
      { field: 'egn_last4', actor: 'a@example.com (сам)' },
      { field: 'name', actor: 'a@example.com (сам)' },
    ])
    const task = open.raw.prepare('SELECT * FROM rik_tasks WHERE id = ?').get(taskId) as Record<string, unknown>
    expect(task).toMatchObject({ person_id: 'a', mir: '23', type: 'self_identity', active: 1, old_name: 'Иван Петров Иванов', old_egn: OLD_EGN, fixed_at: null })
    expect(String(task.detail)).toContain('„Иван Петров Иванов“ → „Иван Петров Иванова“')
    expect(String(task.detail)).toContain(`••••••${OLD_EGN.slice(-4)} → ••••••${NEW_EGN.slice(-4)}`)
    expect(String(task.detail)).not.toContain(OLD_EGN)
    expect(String(task.detail)).not.toContain(NEW_EGN)

    // A second change before the re-issue updates the same task; the old values stay the first ones (what the РИК has).
    const again = (await loadStoredIdentity(open.db, 'signups', 'a'))!
    const second = checkIdentityFix({ ...NAMES, lastName: 'Петрова', egn: '' }, { ...again.names, egn: again.egn })
    if (!second.ok) throw new Error(second.message)
    const { taskId: sameTask } = await recordSelfIdentityChange(open.db, { stored: again, after: second.after, actor: 'a@example.com (сам)', now: '2026-10-23T11:05:00.000Z' })
    expect(sameTask).toBe(taskId)
    const tasks = open.raw.prepare('SELECT * FROM rik_tasks').all() as Array<Record<string, unknown>>
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ old_name: 'Иван Петров Иванов', old_egn: OLD_EGN })
    expect(String(tasks[0]!.detail)).toContain('„Иван Петров Иванов“ → „Иван Петров Петрова“')
  })

  it('„Издай нов документ“: same number and МИР, old file to history, РИК correction from the task values, no data change', async () => {
    const open = await openDb()
    if (!open) return
    seedSignup(open.raw, 'a')
    const stored = (await loadStoredIdentity(open.db, 'signups', 'a'))!
    const check = checkIdentityFix({ ...NAMES, lastName: 'Иванова', egn: NEW_EGN }, { ...stored.names, egn: stored.egn })
    if (!check.ok) throw new Error(check.message)
    const { taskId } = await recordSelfIdentityChange(open.db, { stored, after: check.after, actor: 'a@example.com (сам)', now: '2026-10-23T11:00:00.000Z' })
    const auditBefore = (open.raw.prepare('SELECT COUNT(*) AS n FROM signup_audit').get() as { n: number }).n
    const fresh = (await loadStoredIdentity(open.db, 'signups', 'a'))!
    const now = '2026-10-23T12:00:00.000Z'
    const result = await applyIdentityFix(open.db, {
      stored: fresh,
      after: { ...fresh.names, egn: fresh.egn },
      actor: 'ina@example.com',
      now,
      taskId,
      reissue: { oldName: 'Иван Петров Иванов', oldEgn: OLD_EGN },
    })
    expect(result).toMatchObject({ ok: true, number: 7, mir: '23', nameChanged: true, egnChanged: true, plan: { resign: true, supersede: true } })
    expect(result.message).toContain('Новите данни (от човека)')
    const row = open.raw.prepare('SELECT * FROM signups WHERE id = ?').get('a') as Record<string, unknown>
    expect(row).toMatchObject({ egn: NEW_EGN, designation_number: 7, designation_mir: '23', designation_signed_at: null, designation_drive_file_id: null, designation_pdf_url: null })
    expect(JSON.parse(String(row.payload))).toMatchObject({ lastName: 'Иванова' })
    const audit = open.raw.prepare('SELECT field, actor FROM signup_audit').all() as Array<Record<string, string>>
    // Only the document line is new: the data was audited when the person saved it.
    expect(audit.length).toBe(auditBefore + 1)
    expect(audit.at(-1)).toMatchObject({ field: 'designation_resign', actor: 'ina@example.com' })
    expect(open.raw.prepare('SELECT drive_file_id, reason FROM designation_file_history').all()).toEqual([{ drive_file_id: 'file-old', reason: 'identity_fix' }])
    expect(open.raw.prepare('SELECT old_name, new_name, old_egn, task_id, origin, resign FROM designation_renames').all()).toEqual([
      { old_name: 'Иван Петров Иванов', new_name: 'Иван Петров Иванова', old_egn: OLD_EGN, task_id: taskId, origin: 'identity_fix', resign: 1 },
    ])
    expect(open.raw.prepare('SELECT fixed_at, fixed_by, done_at FROM rik_tasks').get()).toEqual({ fixed_at: now, fixed_by: 'ina@example.com', done_at: null })
  })

  it('task detail without a ЕГН change names only the names', () => {
    const detail = selfTaskDetail({ before: { ...NAMES, egn: OLD_EGN }, after: { ...NAMES, lastName: 'Иванова', egn: OLD_EGN }, mir: '23', number: 7 })
    expect(detail).toContain('Пълномощно № 23/7')
    expect(detail).not.toContain('ЕГН •')
  })
})

describe('wiring', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  it('saveSignup holds the names/ЕГН back before the upsert and returns identityPending', () => {
    const source = read('./db.ts')
    const save = source.slice(source.indexOf('export const saveSignup'), source.indexOf('export const confirmOwnIdentityChange'))
    expect(save.indexOf('holdSelfIdentity(')).toBeGreaterThan(0)
    expect(save.indexOf('holdSelfIdentity(')).toBeLessThan(save.indexOf('INSERT INTO signups'))
    expect(save).toContain('identityPending,')
    const confirm = source.slice(source.indexOf('export const confirmOwnIdentityChange'))
    expect(confirm).toContain('getCookie(SESSION_COOKIE)')
    expect(confirm).toContain('EGN_TAKEN_SQL')
    expect(confirm).toContain('recordSelfIdentityChange(')
    expect(confirm).not.toMatch(/deliverMail|brevo/i)
  })
  it('the РИК sync never closes a self-change task; the re-issue is admin-only', () => {
    expect(read('./rik/sync.ts')).toContain("AND type != 'self_identity'")
    const admin = read('./identity-fix-admin.ts')
    const reissue = admin.slice(admin.indexOf('export const identityReissue'))
    expect(reissue).toContain("gate('fixIdentity')")
    expect(reissue).toContain('reissue: {')
  })
})

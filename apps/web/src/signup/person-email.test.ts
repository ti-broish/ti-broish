// „Без имейл“ switch on a volunteer's page. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({ env: {} }))

import { applySignupSchema, type SignupD1 } from './db-core'
import { isPlaceholderEmail } from './no-email'
import { auditEmail, parsePersonEmailInput, personEmailProblem, setSignupEmail } from './person-email'

type Sqlite = {
  exec(sql: string): void
  prepare(sql: string): { run(...args: unknown[]): { changes: number | bigint }; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }
}

async function openDb(): Promise<Sqlite | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Sqlite }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

function asD1(db: Sqlite): SignupD1 {
  const statement = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => (db.prepare(sql).get(...args) ?? null) as T | null,
    all: async <T>() => ({ results: db.prepare(sql).all(...args) as T[] }),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: Array<{ sql: string; args: unknown[] }>) => {
      db.exec('BEGIN')
      try {
        const out = list.map((item) => ({ success: true, meta: { changes: Number(db.prepare(item.sql).run(...item.args).changes) } }))
        db.exec('COMMIT')
        return out
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    exec: async (sql: string) => db.exec(sql),
  } as unknown as SignupD1
}

const sqlite = await openDb()
const T0 = '2026-10-29T08:00:00.000Z'
const ACTOR = 'staff@example.test'

describe('person e-mail input', () => {
  it('drops a typed address when „Без имейл“ is ticked and needs one otherwise', () => {
    expect(parsePersonEmailInput({ id: 's1', email: 'x@example.org', noEmail: true })).toEqual({ id: 's1', email: '', noEmail: true })
    expect(personEmailProblem(parsePersonEmailInput({ id: 's1', email: '' }))).toMatch(/Без имейл/)
    expect(personEmailProblem(parsePersonEmailInput({ id: 's1', email: 'bez-imeil-x@tibroish.invalid' }))).toMatch(/не е валиден/)
    expect(personEmailProblem(parsePersonEmailInput({ id: 's1', email: ' A@Example.org ' }))).toBeNull()
  })

  it('masks addresses in the audit', () => {
    expect(auditEmail('volunteer@example.org')).toBe('v***@example.org')
    expect(auditEmail('bez-imeil-x@tibroish.invalid')).toBe('без имейл')
  })
})

describe.skipIf(!sqlite)('setSignupEmail (SQLite, as D1)', () => {
  let db: SignupD1
  const row = (id: string) => sqlite!.prepare('SELECT * FROM signups WHERE id = ?').get(id) as Record<string, unknown>

  beforeEach(async () => {
    const raw = sqlite!
    const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>
    for (const table of tables) raw.exec(`DROP TABLE IF EXISTS "${table.name}"`)
    db = asD1(raw)
    await applySignupSchema(db)
    for (const [id, email] of [['s1', 'one@example.test'], ['s2', 'two@example.test']]) {
      await db
        .prepare(`INSERT INTO signups (id, email, session_token, payload, email_confirmed, brevo_section_synced, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'x@y', ?, ?)`)
        .bind(id, email, `tok-${id}`, JSON.stringify({ firstName: 'Тест', email }), T0, T0)
        .run()
    }
  })

  it('real → „Без имейл“: stand-in address, no login, Brevo mark reset, masked audit', async () => {
    const result = await setSignupEmail(db, parsePersonEmailInput({ id: 's1', noEmail: true }), ACTOR, new Date(T0))
    expect(result).toMatchObject({ ok: true, changed: true, noEmail: true, previousEmail: 'one@example.test' })
    const saved = row('s1')
    expect(isPlaceholderEmail(String(saved.email))).toBe(true)
    expect(JSON.parse(String(saved.payload)).email).toBe(saved.email)
    expect(saved).toMatchObject({ session_token: null, brevo_section_synced: null, email_confirmed: 1 })
    const audit = sqlite!.prepare(`SELECT field, before_text, after_text, actor FROM signup_audit WHERE signup_id = 's1'`).all()
    expect(audit).toEqual([{ field: 'email', before_text: 'o***@example.test', after_text: 'без имейл', actor: ACTOR }])
    // Ticking it again changes nothing.
    expect(await setSignupEmail(db, parsePersonEmailInput({ id: 's1', noEmail: true }), ACTOR)).toMatchObject({ ok: true, changed: false })
  })

  it('„Без имейл“ → real: saved lower-case, refused when another record has it', async () => {
    await setSignupEmail(db, parsePersonEmailInput({ id: 's1', noEmail: true }), ACTOR)
    expect(await setSignupEmail(db, parsePersonEmailInput({ id: 's1', email: 'TWO@example.test' }), ACTOR)).toMatchObject({ ok: false })
    const result = await setSignupEmail(db, parsePersonEmailInput({ id: 's1', email: 'New@Example.test' }), ACTOR)
    expect(result).toMatchObject({ ok: true, changed: true, noEmail: false })
    expect(row('s1').email).toBe('new@example.test')
    expect(JSON.parse(String(row('s1').payload)).email).toBe('new@example.test')
  })

  it('two people without an e-mail never collide', async () => {
    await setSignupEmail(db, parsePersonEmailInput({ id: 's1', noEmail: true }), ACTOR)
    await setSignupEmail(db, parsePersonEmailInput({ id: 's2', noEmail: true }), ACTOR)
    expect(row('s1').email).not.toBe(row('s2').email)
  })
})

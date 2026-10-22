import { describe, expect, it } from 'vitest'
import type { SignupD1 } from './db-core'
import { applyRenameTransition, fullName, loadRikCorrections, namesChanged, renameDecision, type DesignationState } from './designation-rename'

const state = (over: Partial<DesignationState> = {}): DesignationState => ({
  number: 509,
  mir: '02',
  generatedAt: '2026-10-19T05:00:00.000Z',
  signingGeneratedAt: '2026-10-19T05:10:00.000Z',
  signedAt: '2026-10-19T05:30:00.000Z',
  firstSignedAt: '2026-10-19T05:30:00.000Z',
  ...over,
})

describe('rename decision', () => {
  it('joins names without a double space for an empty middle name', () => {
    expect(fullName({ firstName: 'Гергана', middleName: '', lastName: 'Начева-Лазарова' })).toBe('Гергана Начева-Лазарова')
    expect(namesChanged({ firstName: 'А', middleName: ' ', lastName: 'Б' }, { firstName: 'А', middleName: '', lastName: 'Б' })).toBe(false)
  })

  it('no number: nothing to re-sign', () => {
    expect(renameDecision(state({ number: null }), { mirSubmittedAt: null, inRegister: false })).toEqual({ resign: false, rikCorrection: false })
  })

  it('numbered but no document yet: keep as is', () => {
    const blank = state({ generatedAt: null, signingGeneratedAt: null, signedAt: null, firstSignedAt: null })
    expect(renameDecision(blank, { mirSubmittedAt: null, inRegister: false })).toEqual({ resign: false, rikCorrection: false })
  })

  it('generated only: re-sign, no РИК correction', () => {
    const generated = state({ signedAt: null, firstSignedAt: null })
    expect(renameDecision(generated, { mirSubmittedAt: '2026-10-19T06:00:00.000Z', inRegister: false })).toEqual({ resign: true, rikCorrection: false })
  })

  it('signed before the МИР submission or already in the register: РИК correction', () => {
    expect(renameDecision(state(), { mirSubmittedAt: '2026-10-19T06:00:00.000Z', inRegister: false }).rikCorrection).toBe(true)
    expect(renameDecision(state(), { mirSubmittedAt: '2026-10-19T05:00:00.000Z', inRegister: false }).rikCorrection).toBe(false)
    expect(renameDecision(state(), { mirSubmittedAt: null, inRegister: true }).rikCorrection).toBe(true)
  })
})

type Sqlite = {
  exec(sql: string): void
  prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }
}

async function openDb(): Promise<Sqlite | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Sqlite }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

/** Just enough of D1 over node:sqlite for these statements. */
function asD1(db: Sqlite): SignupD1 {
  const statement = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => (db.prepare(sql).get(...args) ?? null) as T | null,
    all: async <T>() => ({ results: db.prepare(sql).all(...args) as T[] }),
    run: async () => {
      db.prepare(sql).run(...args)
      return { success: true }
    },
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: Array<{ sql: string; args: unknown[] }>) => {
      db.exec('BEGIN')
      for (const item of list) db.prepare(item.sql).run(...item.args)
      db.exec('COMMIT')
      return []
    },
    exec: async (sql: string) => db.exec(sql),
  } as unknown as SignupD1
}

const sqlite = await openDb()

describe.skipIf(!sqlite)('rename transition (SQLite, as D1)', () => {
  function seed() {
    const raw = sqlite!
    for (const table of ['partner_people', 'signup_audit', 'rik_sources', 'rik_entries', 'designation_renames']) raw.exec(`DROP TABLE IF EXISTS ${table}`)
    raw.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, first_name TEXT, middle_name TEXT, last_name TEXT, designation_mir TEXT,
      designation_number INTEGER, designation_generated_at TEXT, designation_signing_generated_at TEXT, designation_signed_at TEXT,
      designation_first_signed_at TEXT, updated_at TEXT)`)
    raw.exec(`CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT, actor TEXT, field TEXT, before_text TEXT, after_text TEXT, created_at TEXT)`)
    raw.exec(`CREATE TABLE rik_sources (mir TEXT PRIMARY KEY, submitted_at TEXT)`)
    raw.exec(`CREATE TABLE rik_entries (id TEXT PRIMARY KEY, mir TEXT, ours INTEGER, number INTEGER, missing_since TEXT)`)
    raw
      .prepare(`INSERT INTO partner_people VALUES ('pp-1', 'Гергана', '', 'Начева-Лазарова', '02', 509, ?1, ?1, ?2, ?2, ?1)`)
      .run('2026-10-19T05:00:00.000Z', '2026-10-19T05:30:00.000Z')
    raw.prepare(`INSERT INTO rik_sources VALUES ('02', '2026-10-19T05:56:00.000Z')`).run()
    return raw
  }

  it('keeps number and МИР, clears the signing marks, stores the old name and audits', async () => {
    const raw = seed()
    const db = asD1(raw)
    const result = await applyRenameTransition(db, {
      table: 'partner_people',
      id: 'pp-1',
      before: { firstName: 'Гергана', middleName: 'Начева', lastName: 'Начаева-Лазарова' },
      after: { firstName: 'Гергана', middleName: '', lastName: 'Начева-Лазарова' },
      actor: 'admin@example.org',
      now: '2026-10-22T12:00:00.000Z',
    })
    expect(result).toMatchObject({ resign: true, rikCorrection: true, number: 509, mir: '02' })
    const row = raw.prepare('SELECT * FROM partner_people WHERE id = ?').get('pp-1') as Record<string, unknown>
    expect(row).toMatchObject({
      designation_number: 509,
      designation_mir: '02',
      designation_signing_generated_at: null,
      designation_signed_at: null,
      designation_first_signed_at: '2026-10-19T05:30:00.000Z',
    })
    const audit = raw.prepare('SELECT field FROM signup_audit ORDER BY field').all() as Array<{ field: string }>
    expect(audit.map((a) => a.field)).toEqual(['designation_resign', 'name'])
    const corrections = await loadRikCorrections(db)
    expect(corrections.get('pp-1')).toEqual({ personId: 'pp-1', oldNames: ['Гергана Начева Начаева-Лазарова'], newName: 'Гергана Начева-Лазарова' })
  })

  it('without a пълномощно only the name audit is written', async () => {
    const raw = seed()
    raw.exec(`UPDATE partner_people SET designation_generated_at = NULL, designation_signing_generated_at = NULL, designation_signed_at = NULL, designation_first_signed_at = NULL`)
    const db = asD1(raw)
    const result = await applyRenameTransition(db, {
      table: 'partner_people',
      id: 'pp-1',
      before: { firstName: 'А', middleName: '', lastName: 'Б' },
      after: { firstName: 'А', middleName: '', lastName: 'В' },
      actor: 'admin@example.org',
      now: '2026-10-22T12:00:00.000Z',
    })
    expect(result).toMatchObject({ resign: false, rikCorrection: false })
    expect((raw.prepare('SELECT COUNT(*) AS n FROM signup_audit').get() as { n: number }).n).toBe(1)
    expect((await loadRikCorrections(db)).size).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { EGN_IN_USE_MESSAGE, EGN_IN_USE_SQL, EGN_KEY_INDEX, egnNeedsCheck, egnUsedElsewhere } from './egn-in-use'
import type { SignupD1 } from './db-core'

type Db = { exec(sql: string): void; prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown } }

async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

const sqlite = await openDb()

/** The D1 surface egnUsedElsewhere uses, over node:sqlite. */
function d1(db: Db): SignupD1 {
  return {
    prepare(sql: string) {
      const statement = (values: unknown[]) => ({
        bind: (...next: unknown[]) => statement(next),
        first: async <T>() => (db.prepare(sql.replace(/\?(\d+)/g, '?')).get(...values) ?? null) as T | null,
        all: async <T>() => ({ results: db.prepare(sql).all(...values) as T[] }),
        run: async () => ({}),
      })
      return statement([])
    },
  } as unknown as SignupD1
}

describe('egnNeedsCheck', () => {
  it('checks only a new or changed ЕГН', () => {
    expect(egnNeedsCheck('8001010008', '')).toBe(true)
    expect(egnNeedsCheck('8001010008', '8001010013')).toBe(true)
    expect(egnNeedsCheck('8001010008', '8001010008')).toBe(false)
    expect(egnNeedsCheck('8001010008', '800101 0008')).toBe(false)
    expect(egnNeedsCheck('', '8001010008')).toBe(false)
  })
})

describe('the message', () => {
  it('points to /vhod and the team without naming anyone', () => {
    expect(EGN_IN_USE_MESSAGE).toContain('/vhod')
    expect(EGN_IN_USE_MESSAGE).toContain('team@tibroish.bg')
    expect(EGN_IN_USE_SQL).toContain('withdrawn')
    expect(EGN_KEY_INDEX).not.toMatch(/UNIQUE/i)
  })
})

describe.skipIf(!sqlite)('egnUsedElsewhere', () => {
  it('finds another active signup, never a withdrawn one or the own row', async () => {
    const db = sqlite!
    db.exec('CREATE TABLE signups (id TEXT PRIMARY KEY, egn TEXT, withdrawn INTEGER)')
    db.exec(EGN_KEY_INDEX)
    db.exec(`INSERT INTO signups VALUES ('active', '8001010008', 0), ('spaced', ' 800101 0013 ', NULL), ('gone', '7501010006', 1), ('dup-a', '6001010000', 0), ('dup-b', '6001010000', 0)`)
    const store = d1(db)
    expect(await egnUsedElsewhere(store, '8001010008', 'new-row')).toBe(true)
    expect(await egnUsedElsewhere(store, '8001010008', 'active')).toBe(false)
    expect(await egnUsedElsewhere(store, '8001010013', null)).toBe(true)
    expect(await egnUsedElsewhere(store, '7501010006', null)).toBe(false)
    expect(await egnUsedElsewhere(store, '1111111111', null)).toBe(false)
    // Rows that already share an ЕГН in the data: each one still sees the other.
    expect(await egnUsedElsewhere(store, '6001010000', 'dup-a')).toBe(true)
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${EGN_IN_USE_SQL.replace(/\?(\d+)/g, '?')}`).all('x', 'y') as { detail: string }[]
    expect(plan.map((row) => row.detail).join(' ')).toContain('idx_signups_egn_key')
  })
})

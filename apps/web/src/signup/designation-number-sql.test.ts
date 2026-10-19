import { describe, expect, it } from 'vitest'
import {
  DESIGNATION_ASSIGN_SQL,
  DESIGNATION_MAX_PER_MIR_SQL,
  DESIGNATION_NUMBER_UNIQUE_INDEX_SQL,
  PARTNER_DESIGNATION_ASSIGN_SQL,
} from './designation-number'

type Db = {
  exec(sql: string): void
  prepare(sql: string): { run(...args: unknown[]): { changes: number | bigint }; all(...args: unknown[]): unknown[] }
}

async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

const sqlite = await openDb()

describe.skipIf(!sqlite)('designation number SQL (SQLite, as D1)', () => {
  function seed() {
    const db = sqlite!
    db.exec('DROP TABLE IF EXISTS signups')
    db.exec('CREATE TABLE signups (id TEXT PRIMARY KEY, designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, updated_at TEXT)')
    db.exec(DESIGNATION_NUMBER_UNIQUE_INDEX_SQL)
    db.exec('DROP TABLE IF EXISTS partner_people')
    db.exec('CREATE TABLE partner_people (id TEXT PRIMARY KEY, designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, updated_at TEXT)')
    for (const id of ['a', 'b', 'c', 'd']) db.prepare('INSERT INTO signups (id) VALUES (?)').run(id)
    return db
  }

  it('starts each МИР at 501, keeps МИРs independent and never renumbers', () => {
    const db = seed()
    const assign = db.prepare(DESIGNATION_ASSIGN_SQL)
    assign.run('23', '19.10.2026', 'now', 'a')
    assign.run('23', '19.10.2026', 'now', 'b')
    assign.run('01', '20.10.2026', 'now', 'c')
    expect(Number(assign.run('23', '21.10.2026', 'now', 'a').changes)).toBe(0)
    const rows = db.prepare('SELECT id, designation_mir AS mir, designation_number AS n, designation_issued_at AS d FROM signups ORDER BY id').all()
    expect(rows).toEqual([
      { id: 'a', mir: '23', n: 501, d: '19.10.2026' },
      { id: 'b', mir: '23', n: 502, d: '19.10.2026' },
      { id: 'c', mir: '01', n: 501, d: '20.10.2026' },
      { id: 'd', mir: null, n: null, d: null },
    ])
    expect(db.prepare(DESIGNATION_MAX_PER_MIR_SQL).all()).toEqual(
      expect.arrayContaining([
        { mir: '23', n: 502 },
        { mir: '01', n: 501 },
      ]),
    )
  })

  it('rejects a duplicate number within a МИР', () => {
    const db = seed()
    db.prepare(DESIGNATION_ASSIGN_SQL).run('23', '19.10.2026', 'now', 'a')
    expect(() => db.prepare("UPDATE signups SET designation_mir = '23', designation_number = 501 WHERE id = 'b'").run()).toThrow()
    expect(() => db.prepare("UPDATE signups SET designation_mir = '24', designation_number = 501 WHERE id = 'b'").run()).not.toThrow()
  })

  it('shares one counter per МИР between signups and „И аз“ partner people', () => {
    const db = seed()
    db.prepare("INSERT INTO partner_people (id, designation_mir) VALUES ('p1', '23'), ('p2', '23'), ('p3', '02')").run()
    const signup = db.prepare(DESIGNATION_ASSIGN_SQL)
    const partner = db.prepare(PARTNER_DESIGNATION_ASSIGN_SQL)
    signup.run('23', '19.10.2026', 'now', 'a')
    partner.run('23', '19.10.2026', 'now', 'p1')
    signup.run('23', '19.10.2026', 'now', 'b')
    partner.run('23', '19.10.2026', 'now', 'p2')
    partner.run('02', '19.10.2026', 'now', 'p3')
    // Wrong МИР for the partner row: no change, its МИР is fixed on the row.
    expect(Number(partner.run('24', '19.10.2026', 'now', 'p3').changes)).toBe(0)
    const all = db
      .prepare(
        "SELECT id, designation_number AS n FROM signups WHERE designation_number IS NOT NULL UNION ALL SELECT id, designation_number FROM partner_people ORDER BY n, id",
      )
      .all()
    expect(all).toEqual([
      { id: 'a', n: 501 },
      { id: 'p3', n: 501 },
      { id: 'p1', n: 502 },
      { id: 'b', n: 503 },
      { id: 'p2', n: 504 },
    ])
    expect(db.prepare(DESIGNATION_MAX_PER_MIR_SQL).all()).toEqual(
      expect.arrayContaining([
        { mir: '23', n: 504 },
        { mir: '02', n: 501 },
      ]),
    )
  })
})

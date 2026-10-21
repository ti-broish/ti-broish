import { describe, expect, it } from 'vitest'
import { designationNumberAuditSql, PARTNER_WITHDRAW_AUDIT_SQL, PARTNER_WITHDRAW_SQL } from './designation-audit-sql'
import { partnerDuplicateSql, signupDuplicateSql } from './designation-duplicates'
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
    db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, updated_at TEXT,
      egn TEXT, withdrawn INTEGER NOT NULL DEFAULT 0, published_section TEXT)`)
    db.exec(DESIGNATION_NUMBER_UNIQUE_INDEX_SQL)
    db.exec('DROP TABLE IF EXISTS partner_people')
    db.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, updated_at TEXT,
      egn TEXT NOT NULL DEFAULT '', withdrawn_at TEXT, withdrawn_by TEXT, withdrawn_reason TEXT, covered_by_signup_id TEXT)`)
    db.exec('DROP TABLE IF EXISTS signup_audit')
    db.exec('CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT NOT NULL, actor TEXT NOT NULL, field TEXT NOT NULL, before_text TEXT NOT NULL, after_text TEXT NOT NULL, created_at TEXT NOT NULL)')
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

  describe('one ЕГН, one number (guard in the UPDATE, so parallel runs are safe)', () => {
    const numberOf = (db: Db, table: string, id: string) =>
      (db.prepare(`SELECT designation_number AS n FROM ${table} WHERE id = ?`).all(id) as Array<{ n: number | null }>)[0]?.n ?? null

    it('does not number a partner row whose ЕГН a volunteer already holds, nor the reverse', () => {
      const db = seed()
      db.exec("UPDATE signups SET egn = '7001010000', published_section = '030600386' WHERE id = 'a'")
      db.exec("UPDATE signups SET egn = '7202020000', published_section = '171300011' WHERE id = 'b'")
      db.exec("INSERT INTO partner_people (id, designation_mir, egn) VALUES ('p1', '03', '7001010000'), ('p2', '17', '7202020000')")
      db.prepare(DESIGNATION_ASSIGN_SQL).run('03', '19.10.2026', 'now', 'a')
      expect(Number(db.prepare(PARTNER_DESIGNATION_ASSIGN_SQL).run('03', '19.10.2026', 'now', 'p1').changes)).toBe(0)
      // Partner first, then the volunteer: still only one number.
      db.prepare(PARTNER_DESIGNATION_ASSIGN_SQL).run('17', '19.10.2026', 'now', 'p2')
      expect(Number(db.prepare(DESIGNATION_ASSIGN_SQL).run('17', '19.10.2026', 'now', 'b').changes)).toBe(0)
      expect([numberOf(db, 'signups', 'a'), numberOf(db, 'partner_people', 'p1'), numberOf(db, 'partner_people', 'p2'), numberOf(db, 'signups', 'b')]).toEqual([501, null, 501, null])
    })

    it('two runs racing on the same ЕГН: the second UPDATE is a no-op (signups and partner rows alike)', () => {
      const db = seed()
      db.exec("UPDATE signups SET egn = '8001010000' WHERE id IN ('a', 'b')")
      db.exec("INSERT INTO partner_people (id, designation_mir, egn) VALUES ('p1', '23', '8101010000'), ('p2', '23', '8101010000')")
      const signup = db.prepare(DESIGNATION_ASSIGN_SQL)
      const partner = db.prepare(PARTNER_DESIGNATION_ASSIGN_SQL)
      expect(Number(signup.run('23', '19.10.2026', 'run-1', 'a').changes)).toBe(1)
      expect(Number(signup.run('23', '19.10.2026', 'run-2', 'b').changes)).toBe(0)
      expect(Number(partner.run('23', '19.10.2026', 'run-1', 'p1').changes)).toBe(1)
      expect(Number(partner.run('23', '19.10.2026', 'run-2', 'p2').changes)).toBe(0)
      // A row without ЕГН is never blocked by another without ЕГН.
      expect(Number(signup.run('23', '19.10.2026', 'run-2', 'c').changes)).toBe(1)
      expect(Number(signup.run('23', '19.10.2026', 'run-2', 'd').changes)).toBe(1)
    })

    it('a withdrawn holder frees the ЕГН; a withdrawn or covered partner row is never numbered', () => {
      const db = seed()
      db.exec("UPDATE signups SET egn = '9001010000', designation_mir = '03', designation_number = 501, withdrawn = 1 WHERE id = 'a'")
      db.exec("UPDATE signups SET egn = '9101010000' WHERE id = 'b'")
      db.exec(`INSERT INTO partner_people (id, designation_mir, egn, withdrawn_at, covered_by_signup_id) VALUES
        ('p1', '03', '9001010000', NULL, NULL), ('p2', '03', '9201010000', '2026-10-21T10:00:00Z', NULL), ('p3', '03', '9301010000', NULL, 'b'), ('p4', '03', '9401010000', NULL, 'a')`)
      const partner = db.prepare(PARTNER_DESIGNATION_ASSIGN_SQL)
      expect(Number(partner.run('03', '19.10.2026', 'now', 'p1').changes)).toBe(1)
      expect(Number(partner.run('03', '19.10.2026', 'now', 'p2').changes)).toBe(0)
      // Covered by an active volunteer: no number, even though that volunteer has none yet.
      expect(Number(partner.run('03', '19.10.2026', 'now', 'p3').changes)).toBe(0)
      // Covered by a withdrawn volunteer: free again.
      expect(Number(partner.run('03', '19.10.2026', 'now', 'p4').changes)).toBe(1)
      // The withdrawn row keeps its number and the МИР counter still counts it.
      db.exec("UPDATE partner_people SET designation_number = 600 WHERE id = 'p2'")
      db.exec("INSERT INTO partner_people (id, designation_mir, egn) VALUES ('p5', '03', '9501010000')")
      partner.run('03', '19.10.2026', 'now', 'p5')
      expect(numberOf(db, 'partner_people', 'p5')).toBe(601)
    })

    it('writes one audit line per number assigned, only when the UPDATE numbered the row', () => {
      const db = seed()
      db.exec("UPDATE signups SET egn = '7001010000' WHERE id IN ('a', 'b')")
      db.prepare(DESIGNATION_ASSIGN_SQL).run('03', '19.10.2026', 'now', 'a')
      db.prepare(designationNumberAuditSql('signups')).run('au-1', 'admin@example.com', 'now', 'a')
      db.prepare(DESIGNATION_ASSIGN_SQL).run('03', '19.10.2026', 'now', 'b')
      db.prepare(designationNumberAuditSql('signups')).run('au-2', 'admin@example.com', 'now', 'b')
      // A second run never writes a second line for the same number.
      db.prepare(designationNumberAuditSql('signups')).run('au-3', 'admin@example.com', 'now', 'a')
      expect(db.prepare('SELECT signup_id, field, before_text, after_text FROM signup_audit').all()).toEqual([
        { signup_id: 'a', field: 'designation_number', before_text: '', after_text: '03/501 от 19.10.2026' },
      ])
    })

    it('withdraws a partner пълномощно once, keeps number and МИР, and audits it', () => {
      const db = seed()
      db.exec("INSERT INTO partner_people (id, designation_mir, designation_number, egn) VALUES ('pp-1', '03', 515, '7001010000')")
      db.prepare(PARTNER_WITHDRAW_SQL).run('t1', 'admin@example.com', 'Дубликат на № 504 (доброволец)', 'pp-1')
      db.prepare(PARTNER_WITHDRAW_AUDIT_SQL).run('au-1', 'admin@example.com', 't1', 'pp-1')
      // Again: nothing changes, no second line.
      expect(Number(db.prepare(PARTNER_WITHDRAW_SQL).run('t2', 'admin@example.com', 'x', 'pp-1').changes)).toBe(0)
      db.prepare(PARTNER_WITHDRAW_AUDIT_SQL).run('au-2', 'admin@example.com', 't2', 'pp-1')
      expect(db.prepare('SELECT designation_mir AS mir, designation_number AS n, withdrawn_at AS at FROM partner_people').all()).toEqual([{ mir: '03', n: 515, at: 't1' }])
      expect(db.prepare('SELECT field, before_text, after_text FROM signup_audit').all()).toEqual([
        { field: 'partner_withdrawn', before_text: 'активно № 03/515', after_text: 'оттеглено: Дубликат на № 504 (доброволец)' },
      ])
    })

    it('flags the second holder of an ЕГН as the duplicate: volunteer with a section first, then the lower number', () => {
      const db = seed()
      db.exec(`UPDATE signups SET egn = '7001010000', published_section = '030600386', designation_mir = '03', designation_number = 504 WHERE id = 'a'`)
      db.exec(`UPDATE signups SET egn = '7101010000', published_section = '261700022', designation_mir = '26', designation_number = 504 WHERE id = 'b'`)
      db.exec(`UPDATE signups SET egn = '7101010000', published_section = '261700023', designation_mir = '26', designation_number = 505 WHERE id = 'c'`)
      db.exec(`INSERT INTO partner_people (id, designation_mir, designation_number, egn, withdrawn_at) VALUES
        ('pp-a', '03', 515, '7001010000', NULL), ('pp-b', '04', 503, '7201010000', NULL), ('pp-c', '04', 504, '7201010000', NULL), ('pp-w', '03', 516, '7001010000', 'gone')`)
      const signupDup = db.prepare(`SELECT id FROM signups WHERE designation_number IS NOT NULL AND ${signupDuplicateSql('signups')} ORDER BY id`).all()
      const partnerDup = db.prepare(`SELECT id FROM partner_people WHERE designation_number IS NOT NULL AND withdrawn_at IS NULL AND ${partnerDuplicateSql('partner_people')} ORDER BY id`).all()
      expect(signupDup).toEqual([{ id: 'c' }])
      expect(partnerDup).toEqual([{ id: 'pp-a' }, { id: 'pp-c' }])
    })
  })
})

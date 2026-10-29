import { describe, expect, it } from 'vitest'
import { PARTNER_WITHDRAW_SQL } from './designation-audit-sql'
import {
  DESIGNATION_ASSIGN_SQL,
  DESIGNATION_HIGH_WATER_TABLE,
  DESIGNATION_HIGH_WATER_TRIGGERS,
  DESIGNATION_MAX_PER_MIR_SQL,
  DESIGNATION_NUMBER_UNIQUE_INDEX_SQL,
  PARTNER_DESIGNATION_ASSIGN_SQL,
} from './designation-number'
import {
  DESIGNATION_NUMBERS_BACKFILL,
  DESIGNATION_NUMBERS_DRY_RUN_SQL,
  DESIGNATION_NUMBERS_HIGH_WATER_TRIGGER,
  DESIGNATION_NUMBERS_INDEXES,
  DESIGNATION_NUMBERS_RIK_BACKFILL,
  DESIGNATION_NUMBERS_SQL,
  DESIGNATION_NUMBERS_TABLE,
  DESIGNATION_NUMBERS_TRIGGERS,
} from './designation-numbers'
import { RIK_TABLES } from './rik/sql'

type Db = {
  exec(sql: string): void
  prepare(sql: string): { run(...args: unknown[]): { changes: number | bigint }; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }
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

type LedgerRow = { mir: string; number: number; holder: string; person_id: string | null; state: string; moved_to: string; name: string; issued_on: string }

describe.skipIf(!sqlite)('designation_numbers ledger (SQLite, as D1)', () => {
  /** Tables as in production (only the columns the ledger and the assign SQL read). */
  function seed({ ledger = true }: { ledger?: boolean } = {}) {
    const db = sqlite!
    for (const t of ['signups', 'partner_people', 'signup_audit', 'designation_high_water', 'designation_numbers', 'rik_entries']) db.exec(`DROP TABLE IF EXISTS ${t}`)
    db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, updated_at TEXT,
      egn TEXT, withdrawn INTEGER NOT NULL DEFAULT 0, published_section TEXT)`)
    db.exec(DESIGNATION_NUMBER_UNIQUE_INDEX_SQL)
    db.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, updated_at TEXT,
      egn TEXT NOT NULL DEFAULT '', withdrawn_at TEXT, withdrawn_by TEXT, withdrawn_reason TEXT, covered_by_signup_id TEXT)`)
    db.exec('CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT NOT NULL, actor TEXT NOT NULL, field TEXT NOT NULL, before_text TEXT NOT NULL, after_text TEXT NOT NULL, created_at TEXT NOT NULL)')
    for (const sql of RIK_TABLES) if (sql.includes('rik_entries (')) db.exec(sql)
    db.exec(DESIGNATION_HIGH_WATER_TABLE)
    for (const sql of DESIGNATION_HIGH_WATER_TRIGGERS) db.exec(sql)
    db.exec(DESIGNATION_NUMBERS_TABLE)
    if (ledger) for (const sql of [...DESIGNATION_NUMBERS_INDEXES, ...DESIGNATION_NUMBERS_TRIGGERS, DESIGNATION_NUMBERS_HIGH_WATER_TRIGGER]) db.exec(sql)
    return db
  }

  const ledger = (db: Db) =>
    db.prepare('SELECT mir, number, holder, person_id, state, moved_to, name, issued_on FROM designation_numbers ORDER BY mir, number').all() as LedgerRow[]
  const row = (db: Db, mir: string, number: number) => ledger(db).find((r) => r.mir === mir && r.number === number)
  const numberOf = (db: Db, table: string, id: string) => (db.prepare(`SELECT designation_number AS n FROM ${table} WHERE id = ?`).get(id) as { n: number }).n

  let auditId = 0
  const audit = (db: Db, personId: string, text: string, at: string) =>
    db.prepare(`INSERT INTO signup_audit VALUES (?, ?, 'admin', 'designation_number', '', ?, ?)`).run(`a${++auditId}`, personId, text, at)
  let entryId = 0
  const rikRow = (db: Db, mir: string, number: number | null, name: string, opts: { annulled?: boolean; missing?: boolean; ours?: boolean; date?: string } = {}) =>
    db
      .prepare(`INSERT INTO rik_entries (id, mir, kind, ours, party, source_url, name, name_key, number_raw, number, number_date, annulled, first_seen_at, last_seen_at, missing_since)
        VALUES (?, ?, 'representative', ?, '', ?, ?, ?, ?, ?, ?, ?, '2026-10-23', '2026-10-29', ?)`)
      .run(`e${++entryId}`, mir, opts.ours === false ? 0 : 1, `https://rik${mir}.cik.bg/pvr2026/registers/register_p?id=1`, name, name.toLowerCase(),
        `${number}/${opts.date ?? '23.10.2026'}`, number, opts.date ?? '23.10.2026', opts.annulled ? 1 : 0, opts.missing ? '2026-10-25' : null)

  /**
   * A small copy of the production shape (no real people): current holders, moves recorded in the
   * audit (МИР 23 → 26, 31 → 32, the 01 renumber), withdrawals, and РИК register rows held by
   * people outside our database.
   */
  function productionShape(db: Db) {
    const signup = db.prepare(`INSERT INTO signups (id, designation_mir, designation_number, designation_issued_at, withdrawn) VALUES (?, ?, ?, ?, ?)`)
    const partner = db.prepare(`INSERT INTO partner_people (id, designation_mir, designation_number, designation_issued_at, withdrawn_at) VALUES (?, ?, ?, ?, ?)`)
    signup.run('s1', '01', 514, '21.10.2026', 0)
    signup.run('s2', '01', 523, '29.10.2026', 0) // was 01/516: the number is held outside in РИК 01
    signup.run('s3', '25', 511, '21.10.2026', 1) // отписан, number kept
    partner.run('pp-a', '26', 525, '22.10.2026', null) // was 23/514
    partner.run('pp-b', '32', 519, '21.10.2026', null) // was 31/504
    partner.run('pp-c', '03', 515, '21.10.2026', '2026-10-21') // duplicate, withdrawn
    partner.run('pp-d', '31', 503, '21.10.2026', null)
    audit(db, 's1', '01/514 от 21.10.2026', '2026-10-21T10:00:00Z')
    audit(db, 's2', '01/516 от 29.10.2026', '2026-10-29T10:00:00Z')
    audit(db, 's2', '01/523 от 29.10.2026 (01/516 зает външно в РИК 01)', '2026-10-29T17:05:00Z')
    audit(db, 'pp-a', '23/514 от 22.10.2026', '2026-10-22T10:00:00Z')
    audit(db, 'pp-a', '26/525 от 22.10.2026', '2026-10-22T12:26:00Z')
    audit(db, 'pp-b', '31/504 от 21.10.2026', '2026-10-21T10:00:00Z')
    audit(db, 'pp-b', '32/519 от 21.10.2026 (МИР 31 → 32, Извън страната; 31/504 освободен)', '2026-10-21T12:00:00Z')
    // РИК registers under our coalition.
    rikRow(db, '01', 514, 'Наш Човек Едно', { date: '21.10.2026' }) // ours: no external row
    rikRow(db, '01', 516, 'Външен Човек Две') // our old number, held outside: stays „moved“ (PR 2 adds the name)
    rikRow(db, '30', 504, 'Външен Човек Три')
    rikRow(db, '30', 505, 'Външен Човек Четири')
    rikRow(db, '31', 519, 'Външен Човек Пет', { missing: true, date: '21.10.2026' })
    rikRow(db, '31', 519, 'Анулиран', { annulled: true, date: '21.10.2026' })
    rikRow(db, '31', 520, 'Анулиран', { annulled: true, date: '21.10.2026' })
    rikRow(db, '31', 521, 'Анулиран', { annulled: true, date: '22.10.2026' })
    rikRow(db, '19', 1, 'Външен Човек Шест', { date: '19.10.2026' })
    rikRow(db, '19', 5100, 'Грешно Прочетен') // a parsing slip must not burn a range
    rikRow(db, '19', null, 'Без Номер')
    rikRow(db, '12', 530, 'Друга Партия', { ours: false })
  }

  function backfill(db: Db) {
    for (const sql of DESIGNATION_NUMBERS_BACKFILL) db.exec(sql)
    db.exec(DESIGNATION_NUMBERS_RIK_BACKFILL)
  }

  const counts = (db: Db) =>
    db.prepare('SELECT holder, state, COUNT(*) AS n FROM designation_numbers GROUP BY holder, state ORDER BY holder, state').all() as Array<{ holder: string; state: string; n: number }>

  describe('backfill', () => {
    it('records current numbers, moves from the audit, withdrawals and РИК externals; idempotent', () => {
      const db = seed({ ledger: false })
      productionShape(db)
      backfill(db)
      backfill(db)
      expect(counts(db)).toEqual([
        { holder: 'external', state: 'external', n: 6 },
        { holder: 'partner', state: 'active', n: 3 },
        { holder: 'partner', state: 'moved', n: 2 },
        { holder: 'partner', state: 'withdrawn', n: 1 },
        { holder: 'signup', state: 'active', n: 2 },
        { holder: 'signup', state: 'moved', n: 1 },
        { holder: 'signup', state: 'withdrawn', n: 1 },
      ])
      expect(row(db, '23', 514)).toMatchObject({ holder: 'partner', person_id: 'pp-a', state: 'moved', moved_to: '26/525', issued_on: '22.10.2026' })
      expect(row(db, '31', 504)).toMatchObject({ state: 'moved', moved_to: '32/519' })
      expect(row(db, '01', 516)).toMatchObject({ holder: 'signup', person_id: 's2', state: 'moved', moved_to: '01/523' })
      expect(row(db, '25', 511)).toMatchObject({ state: 'withdrawn', person_id: 's3' })
      expect(row(db, '03', 515)).toMatchObject({ state: 'withdrawn', holder: 'partner' })
      // Externals: a named row wins (who held it); an annulled-only number is reserved without a name.
      expect(row(db, '30', 504)).toMatchObject({ holder: 'external', person_id: null, name: 'Външен Човек Три', issued_on: '23.10.2026' })
      expect(row(db, '31', 519)).toMatchObject({ holder: 'external', name: 'Външен Човек Пет' })
      expect(db.prepare(`SELECT note FROM designation_numbers WHERE mir = '31' AND number = 519`).get()).toEqual({ note: 'в регистъра на РИК 31, Анулиран, вече не е в регистъра' })
      expect(row(db, '31', 521)).toMatchObject({ holder: 'external', name: '' })
      expect(row(db, '19', 1)).toMatchObject({ holder: 'external' })
      expect(row(db, '19', 5100)).toBeUndefined()
      expect(row(db, '12', 530)).toBeUndefined()
      expect(row(db, '01', 514)).toMatchObject({ holder: 'signup', state: 'active' })
    })

    it('the read-only dry run counts exactly what the backfill writes', () => {
      const db = seed({ ledger: false })
      productionShape(db)
      const dry = db.prepare(DESIGNATION_NUMBERS_DRY_RUN_SQL).all()
      backfill(db)
      expect(dry).toEqual(counts(db))
    })

    it('runs through the bootstrap list without a rik_entries table (fresh database)', () => {
      const db = seed()
      db.exec('DROP TABLE rik_entries')
      db.prepare(`INSERT INTO signups (id, designation_mir, designation_number, designation_issued_at) VALUES ('x', '05', 501, '19.10.2026')`).run()
      const failed: string[] = []
      for (const sql of DESIGNATION_NUMBERS_SQL) {
        try {
          db.exec(sql)
        } catch (error) {
          failed.push(String(error))
        }
      }
      expect(failed).toHaveLength(1)
      expect(failed[0]).toMatch(/rik_entries/)
      expect(row(db, '05', 501)).toMatchObject({ state: 'active' })
    })
  })

  describe('next number', () => {
    it('skips ahead past external and annulled register numbers (МИР 31 → 522, МИР 30 → 506)', () => {
      const db = seed()
      productionShape(db)
      backfill(db)
      db.prepare(`INSERT INTO partner_people (id, designation_mir) VALUES ('pp-new', '31')`).run()
      db.prepare(PARTNER_DESIGNATION_ASSIGN_SQL).run('31', '30.10.2026', 'now', 'pp-new')
      expect(numberOf(db, 'partner_people', 'pp-new')).toBe(522)
      db.prepare(`INSERT INTO signups (id) VALUES ('s-new')`).run()
      db.prepare(DESIGNATION_ASSIGN_SQL).run('30', '30.10.2026', 'now', 's-new')
      expect(numberOf(db, 'signups', 's-new')).toBe(506)
      const max = Object.fromEntries((db.prepare(DESIGNATION_MAX_PER_MIR_SQL).all() as Array<{ mir: string; n: number }>).map((r) => [r.mir, r.n]))
      expect(max).toMatchObject({ '31': 522, '30': 506, '01': 523 })
    })

    it('an external row raises the high-water mark too (safety net)', () => {
      const db = seed()
      productionShape(db)
      backfill(db)
      expect(db.prepare(`SELECT n FROM designation_high_water WHERE mir = '31'`).get()).toEqual({ n: 521 })
    })
  })

  describe('triggers', () => {
    it('assign → active; move to another МИР → old row „moved“ with moved_to; next number never reuses it', () => {
      const db = seed()
      for (const id of ['a', 'b']) db.prepare('INSERT INTO signups (id) VALUES (?)').run(id)
      db.prepare(DESIGNATION_ASSIGN_SQL).run('23', '22.10.2026', 'now', 'a')
      expect(row(db, '23', 501)).toMatchObject({ holder: 'signup', person_id: 'a', state: 'active', issued_on: '22.10.2026' })
      db.exec(`UPDATE signups SET designation_mir = '26', designation_number = 525 WHERE id = 'a'`)
      expect(row(db, '23', 501)).toMatchObject({ state: 'moved', moved_to: '26/525' })
      expect(row(db, '26', 525)).toMatchObject({ state: 'active', person_id: 'a' })
      db.prepare(DESIGNATION_ASSIGN_SQL).run('23', '22.10.2026', 'now', 'b')
      expect(numberOf(db, 'signups', 'b')).toBe(502)
    })

    it('renumber within a МИР (01/515 → 01/522, manual SQL as on 29.10) keeps the old number burned', () => {
      const db = seed()
      db.prepare(`INSERT INTO partner_people (id, designation_mir, designation_number, designation_issued_at) VALUES ('pp-r', '01', 515, '29.10.2026')`).run()
      db.prepare(`INSERT INTO signups (id) VALUES ('later')`).run()
      db.exec(`UPDATE partner_people SET designation_number = 522 WHERE id = 'pp-r'`)
      expect(row(db, '01', 515)).toMatchObject({ holder: 'partner', state: 'moved', moved_to: '01/522' })
      expect(row(db, '01', 522)).toMatchObject({ state: 'active', person_id: 'pp-r' })
      db.prepare(DESIGNATION_ASSIGN_SQL).run('01', '30.10.2026', 'now', 'later')
      expect(numberOf(db, 'signups', 'later')).toBe(523)
    })

    it('„Отпиши“ / „Върни“ for volunteers and „И аз“ people, and a cleared number', () => {
      const db = seed()
      db.prepare(`INSERT INTO signups (id, designation_mir, designation_number) VALUES ('v', '25', 511)`).run()
      db.prepare(`INSERT INTO partner_people (id, designation_mir, designation_number) VALUES ('pp-w', '31', 503)`).run()
      db.exec(`UPDATE signups SET withdrawn = 1, updated_at = 'now' WHERE id = 'v'`)
      expect(row(db, '25', 511)).toMatchObject({ state: 'withdrawn' })
      db.exec(`UPDATE signups SET withdrawn = 0 WHERE id = 'v'`)
      expect(row(db, '25', 511)).toMatchObject({ state: 'active' })
      db.prepare(PARTNER_WITHDRAW_SQL).run('2026-10-29T10:27:34Z', 'admin', 'член на СИК', 'pp-w')
      expect(row(db, '31', 503)).toMatchObject({ state: 'withdrawn', holder: 'partner' })
      db.exec(`UPDATE partner_people SET withdrawn_at = NULL WHERE id = 'pp-w'`)
      expect(row(db, '31', 503)).toMatchObject({ state: 'active' })
      db.exec(`UPDATE signups SET designation_number = NULL WHERE id = 'v'`)
      expect(row(db, '25', 511)).toMatchObject({ state: 'released', moved_to: '' })
    })

    it('never takes over an external row: a manual number on top of one leaves the external holder', () => {
      const db = seed()
      productionShape(db)
      backfill(db)
      db.prepare(`INSERT INTO signups (id) VALUES ('clash')`).run()
      db.exec(`UPDATE signups SET designation_mir = '30', designation_number = 504 WHERE id = 'clash'`)
      expect(row(db, '30', 504)).toMatchObject({ holder: 'external', person_id: null, state: 'external' })
    })

    it('an unrelated update does not touch the ledger', () => {
      const db = seed()
      db.prepare(`INSERT INTO signups (id, designation_mir, designation_number) VALUES ('u', '05', 501)`).run()
      const before = ledger(db)
      db.exec(`UPDATE signups SET published_section = '050100001', egn = 'x' WHERE id = 'u'`)
      expect(ledger(db)).toEqual(before)
    })
  })
})

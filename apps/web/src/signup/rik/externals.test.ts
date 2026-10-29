import { describe, expect, it, vi } from 'vitest'
import type { SignupD1 } from '../db-core'
import { DESIGNATION_HIGH_WATER_TABLE, DESIGNATION_HIGH_WATER_TRIGGERS, DESIGNATION_MAX_PER_MIR_SQL } from '../designation-number'
import { DESIGNATION_NUMBERS_SQL, DESIGNATION_NUMBERS_TABLE } from '../designation-numbers'
import { EXTERNAL_NUMBER_UPSERT_SQL, findExternalNumbers, RECLAIMED_NUMBER_UPSERT_SQL } from './externals'
import { buildIndex, type RikEntryRow, type RikPerson } from './match'
import { nameKey } from './normalize'
import { RIK_COLUMNS, RIK_INDEXES, RIK_TABLES } from './sql'
import { createRikSync } from './sync'

vi.mock('cloudflare:workers', () => ({ env: {} }))

/** Fake names only. */
function person(id: string, name: string, mir: string, number: number, patch: Partial<RikPerson> = {}): RikPerson {
  return { id, source: 'signup', mir, number, issuedOn: '22.10.2026', nameKey: nameKey(name), withdrawn: false, signedAt: null, ...patch }
}
let seq = 0
function entry(mir: string, number: number, name: string, patch: Partial<RikEntryRow> = {}): RikEntryRow {
  seq += 1
  return {
    id: `e${seq}`,
    mir,
    kind: 'representative',
    ours: true,
    party: 'ИК',
    name,
    nameKey: nameKey(name),
    number,
    numberDate: '23.10.2026',
    annulled: false,
    missingSince: null,
    sourceUrl: `https://rik${mir}.cik.bg/pvr2026/registers/register_p?id=${seq}`,
    ...patch,
  }
}

describe('external numbers: name first, never number first', () => {
  const people = [
    person('m1', 'Наш Преместен Първи', '01', 522), // held 01/515 before the renumber
    person('a1', 'Наш Активен Втори', '01', 514),
    person('t1', 'Наш Сгрешен Трети', '23', 501),
    person('w1', 'Наш Отписан Четвърти', '03', 515, { withdrawn: true }),
  ]
  const ledgerOurs = new Set(['01:514', '01:515', '01:522', '23:501', '23:505', '03:515'])
  const entries = [
    entry('01', 515, 'Пламен Стоянов Костов'), // our old number, held outside: external, attached to our moved row
    entry('01', 514, 'Наш Активен Втори'), // ours, registered
    entry('23', 501, 'Наш Сгрешен Трти'), // ours with a typo: never external
    entry('30', 504, 'Гергана Илиева Маринова'), // a number we never issued
    entry('31', 519, 'Анулиран', { annulled: true }),
    entry('31', 519, 'Цветан Божидаров Ангелов', { missingSince: '2026-10-25' }), // named row wins, notes both
    entry('31', 520, 'Анулиран', { annulled: true }), // only „Анулиран“, never ours: reserved, no name
    entry('23', 505, 'Анулиран', { annulled: true }), // our own annulled number: not external
    entry('19', 1200, 'Грешка Парсване Някаква'), // parse slip: ignored
    entry('19', 2, 'Друг Партиен Човек', { ours: false }), // another party: never
  ]
  const unnumbered = [{ id: 'u1', nameKey: nameKey('Гергана Илиева Маринова') }, { id: 'u2', nameKey: nameKey('Съвсем Друг Човек') }]

  it('reserves only numbers whose rows name none of ours', () => {
    const { numbers } = findExternalNumbers(entries, buildIndex(entries, people), ledgerOurs, unnumbered)
    expect(numbers.map((one) => `${one.mir}/${one.number}`)).toEqual(['01/515', '30/504', '31/519', '31/520'])
    const by = new Map(numbers.map((one) => [`${one.mir}/${one.number}`, one]))
    expect(by.get('01/515')).toMatchObject({ name: 'Пламен Стоянов Костов', issuedOn: '23.10.2026', note: 'в регистъра на РИК 01', ourNote: 'зает външно в РИК 01' })
    expect(by.get('31/519')).toMatchObject({ name: 'Цветан Божидаров Ангелов', note: 'в регистъра на РИК 31, Анулиран, вече не е в регистъра' })
    expect(by.get('31/520')).toMatchObject({ name: '', note: 'в регистъра на РИК 31, Анулиран' })
    expect(by.get('01/515')!.url).toMatch(/^https:\/\/rik01\.cik\.bg\//)
  })

  it('a name like someone of ours without a number: „Възможно съвпадение“, never linked', () => {
    const { numbers, tasks } = findExternalNumbers(entries, buildIndex(entries, people), ledgerOurs, unnumbered)
    expect(numbers.find((one) => one.number === 504)).toMatchObject({ possible: ['u1'], note: 'в регистъра на РИК 30, Възможно съвпадение' })
    expect(tasks).toEqual([expect.objectContaining({ id: 'u1:possible_match:30/504', personId: 'u1', mir: '30', type: 'possible_match', reason: 'external' })])
    expect(tasks[0]!.detail).toContain('Не е свързан автоматично')
  })

  it('registered in РИК 31 for one of ours now in 32: ours, moved, never external (31/519, 31/520)', () => {
    const movers = [...people, person('v1', 'Наш Пътуващ Пети', '32', 519, { source: 'partner' })]
    const rows = [entry('31', 519, 'Анулиран', { annulled: true }), entry('31', 519, 'Наш Пътуващ Пети', { missingSince: '2026-10-25' })]
    const index = buildIndex(rows, movers, new Map([['v1', new Set(['31', '32'])]]))
    const found = findExternalNumbers(rows, index, new Set(['32:519']))
    expect(found.numbers).toEqual([])
    expect(found.reclaimed).toEqual([
      expect.objectContaining({ mir: '31', number: 519, holder: 'partner', personId: 'v1', movedTo: '32/519', note: 'в регистъра на РИК 31, Анулиран, преместен в РИК 32' }),
    ])
    // Already ours in the ledger, or still in the same МИР (a number mix-up): nothing to relabel.
    expect(findExternalNumbers(rows, index, new Set(['31:519'])).reclaimed).toEqual([])
    const stayed = [entry('23', 510, 'Наш Сгрешен Трети')]
    expect(findExternalNumbers(stayed, buildIndex(stayed, people), ledgerOurs).reclaimed).toEqual([])
  })

  it('the withdrawn holder of a number keeps it as ours', () => {
    const withdrawnRow = [entry('03', 515, 'Наш Отписан Четвърти')]
    expect(findExternalNumbers(withdrawnRow, buildIndex(withdrawnRow, people), ledgerOurs).numbers).toEqual([])
  })
})

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): { run(...values: unknown[]): unknown; get(...values: unknown[]): unknown; all(...values: unknown[]): unknown[] }
}
const sqliteModule = 'node:sqlite'
const sqlite = (await import(/* @vite-ignore */ sqliteModule).catch(() => null)) as { DatabaseSync: new (path: string) => SqliteDatabase } | null

function d1(raw: SqliteDatabase): SignupD1 {
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => raw.prepare(sql).run(...values),
    first: async <T,>() => (raw.prepare(sql).get(...values) as T | undefined) ?? null,
    all: async <T,>() => ({ results: raw.prepare(sql).all(...values) as T[] }),
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async <T,>(statements: ReturnType<SignupD1['prepare']>[]) => {
      raw.exec('BEGIN')
      const out: unknown[] = []
      for (const one of statements) out.push(await one.run())
      raw.exec('COMMIT')
      return out as T[]
    },
  }
}

describe.skipIf(!sqlite)('external numbers in the ledger and the РИК sync (SQLite, as D1)', () => {
  function seed() {
    const raw = new sqlite!.DatabaseSync(':memory:')
    raw.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, payload TEXT NOT NULL, designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT,
      designation_signed_at TEXT, designation_first_signed_at TEXT, withdrawn INTEGER NOT NULL DEFAULT 0, sections TEXT NOT NULL DEFAULT '',
      egn TEXT NOT NULL DEFAULT '', published_section TEXT, updated_at TEXT)`)
    raw.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, first_name TEXT, middle_name TEXT, last_name TEXT, designation_mir TEXT, designation_number INTEGER,
      designation_issued_at TEXT, designation_signed_at TEXT, designation_first_signed_at TEXT, egn TEXT NOT NULL DEFAULT '', withdrawn_at TEXT, updated_at TEXT)`)
    raw.exec('CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT NOT NULL, actor TEXT NOT NULL, field TEXT NOT NULL, before_text TEXT NOT NULL, after_text TEXT NOT NULL, created_at TEXT NOT NULL)')
    for (const sql of [...RIK_TABLES, ...RIK_INDEXES]) raw.exec(sql)
    for (const [table, column, definition] of RIK_COLUMNS) {
      const has = (raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((one) => one.name === column)
      if (!has) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
    raw.exec(DESIGNATION_HIGH_WATER_TABLE)
    for (const sql of DESIGNATION_HIGH_WATER_TRIGGERS) raw.exec(sql)
    raw.exec(DESIGNATION_NUMBERS_TABLE)
    for (const sql of DESIGNATION_NUMBERS_SQL.slice(1)) raw.exec(sql)
    return raw
  }
  const signup = (raw: SqliteDatabase, id: string, name: string, mir: string | null, number: number | null) => {
    const [firstName, middleName, lastName] = name.split(' ')
    raw.prepare(`INSERT INTO signups (id, payload, designation_mir, designation_number, designation_issued_at) VALUES (?, ?, ?, ?, '22.10.2026')`).run(
      id, JSON.stringify({ firstName, middleName, lastName }), mir, number)
  }
  let entryNo = 0
  const rik = (raw: SqliteDatabase, mir: string, number: number, name: string, annulled = false) =>
    raw.prepare(`INSERT INTO rik_entries (id, mir, kind, ours, party, source_url, name, name_key, number_raw, number, number_date, annulled, first_seen_at, last_seen_at)
      VALUES (?, ?, 'representative', 1, 'ИК', ?, ?, ?, ?, ?, '23.10.2026', ?, '2026-10-23', '2026-10-29')`)
      .run(`r${++entryNo}`, mir, `https://rik${mir}.cik.bg/pvr2026/registers/register_p?id=7`, name, nameKey(name), `${number}/23.10.2026`, number, annulled ? 1 : 0)
  const ledgerRow = (raw: SqliteDatabase, mir: string, number: number) =>
    raw.prepare('SELECT holder, person_id, state, moved_to, name, note, rik_url, updated_at FROM designation_numbers WHERE mir = ? AND number = ?').get(mir, number) as Record<string, unknown> | undefined
  const nextIn = (raw: SqliteDatabase, mir: string) =>
    Number((raw.prepare(`SELECT MAX(n) AS n FROM (${DESIGNATION_MAX_PER_MIR_SQL}) WHERE mir = ?`).get(mir) as { n: number }).n) + 1
  const tasks = (raw: SqliteDatabase) => raw.prepare('SELECT id, type, reason, active FROM rik_tasks ORDER BY id').all() as Array<{ id: string; type: string; reason: string; active: number }>

  it('the upsert: new external, refresh, our moved row keeps its state and gains the holder; idempotent', () => {
    const raw = seed()
    signup(raw, 'm1', 'Наш Преместен Първи', '01', 515)
    raw.prepare(`UPDATE signups SET designation_number = 522 WHERE id = 'm1'`).run() // the renumber
    const upsert = (mir: string, number: number, name: string, note: string, at: string) =>
      raw.prepare(EXTERNAL_NUMBER_UPSERT_SQL).run(mir, number, '23.10.2026', name, 'r1', `https://rik${mir}.cik.bg/x`, note, `зает външно в РИК ${mir}`, at)
    upsert('01', 515, 'Пламен Стоянов Костов', 'в регистъра на РИК 01', '2026-10-29T18:00:00Z')
    expect(ledgerRow(raw, '01', 515)).toMatchObject({ holder: 'signup', person_id: 'm1', state: 'moved', moved_to: '01/522', name: 'Пламен Стоянов Костов', note: 'зает външно в РИК 01' })
    upsert('01', 515, 'Пламен Стоянов Костов', 'в регистъра на РИК 01', '2026-10-29T19:00:00Z')
    expect(ledgerRow(raw, '01', 515)).toMatchObject({ note: 'зает външно в РИК 01', updated_at: '2026-10-29T18:00:00Z' })
    upsert('31', 519, '', 'в регистъра на РИК 31, Анулиран', '2026-10-29T18:00:00Z')
    expect(ledgerRow(raw, '31', 519)).toMatchObject({ holder: 'external', state: 'external', person_id: null, name: '', note: 'в регистъра на РИК 31, Анулиран' })
    expect(nextIn(raw, '31')).toBe(520)
    // The register later shows the name: refreshed.
    upsert('31', 519, 'Цветан Божидаров Ангелов', 'в регистъра на РИК 31, Анулиран', '2026-10-29T19:00:00Z')
    expect(ledgerRow(raw, '31', 519)).toMatchObject({ holder: 'external', name: 'Цветан Божидаров Ангелов', updated_at: '2026-10-29T19:00:00Z' })
  })

  it('the relabel: an external row becomes our moved row; our own rows are never taken over', () => {
    const raw = seed()
    signup(raw, 'm1', 'Наш Пътуващ Пети', '32', 519)
    raw.prepare(EXTERNAL_NUMBER_UPSERT_SQL).run('31', 519, '23.10.2026', '', 'r1', 'https://rik31.cik.bg/x', 'в регистъра на РИК 31, Анулиран', 'зает външно в РИК 31', '2026-10-29T18:00:00Z')
    const relabel = (mir: string, number: number, at: string) =>
      raw.prepare(RECLAIMED_NUMBER_UPSERT_SQL).run(mir, number, '23.10.2026', 'signup', 'm1', '32/519', 'r2', 'https://rik31.cik.bg/y', 'в регистъра на РИК 31, Анулиран, преместен в РИК 32', at)
    relabel('31', 519, '2026-10-29T19:00:00Z')
    expect(ledgerRow(raw, '31', 519)).toMatchObject({ holder: 'signup', person_id: 'm1', state: 'moved', moved_to: '32/519', name: '', note: 'в регистъра на РИК 31, Анулиран, преместен в РИК 32' })
    relabel('31', 519, '2026-10-29T20:00:00Z')
    expect(ledgerRow(raw, '31', 519)).toMatchObject({ updated_at: '2026-10-29T19:00:00Z' })
    relabel('32', 519, '2026-10-29T20:00:00Z')
    expect(ledgerRow(raw, '32', 519)).toMatchObject({ holder: 'signup', state: 'active', moved_to: '' })
    relabel('31', 530, '2026-10-29T20:00:00Z')
    expect(ledgerRow(raw, '31', 530)).toMatchObject({ holder: 'signup', state: 'moved' })
    expect(nextIn(raw, '31')).toBe(531)
  })

  it('every sync: externals into the ledger, „зает външно“ for an active holder, possible matches, a stale number_taken task closed', async () => {
    const raw = seed()
    signup(raw, 'a1', 'Наш Активен Първи', '01', 515) // still holds a number taken outside
    signup(raw, 'r1', 'Наш Регистриран Втори', '01', 514)
    signup(raw, 'u1', 'Без Номер Някой', null, null) // in our database, no number
    rik(raw, '01', 514, 'Наш Регистриран Втори')
    rik(raw, '01', 515, 'Пламен Стоянов Костов')
    rik(raw, '30', 504, 'Без Номер Някои') // one letter off our unnumbered person
    rik(raw, '31', 520, 'Анулиран', true)
    for (const mir of ['01', '30', '31']) raw.prepare(`INSERT INTO rik_sources (mir, health, last_good_health) VALUES (?, 'ok', 'ok')`).run(mir)
    // The old matcher's task for the same conflict.
    raw.prepare(`INSERT INTO rik_tasks (id, person_id, mir, type, reason, detail, active, created_at, updated_at) VALUES ('a1:call_rik:number_taken', 'a1', '01', 'call_rik', 'number_taken', '', 1, '2026-10-29', '2026-10-29')`).run()
    const before = JSON.stringify(raw.prepare('SELECT * FROM signups ORDER BY id').all())

    const sync = createRikSync(d1(raw), { trigger: 'manual', now: () => new Date('2026-10-29T19:00:00Z') })
    const counts = await sync.rematch()
    expect(counts.externals).toBe(3)
    expect(ledgerRow(raw, '01', 515)).toMatchObject({ holder: 'signup', person_id: 'a1', state: 'active', name: 'Пламен Стоянов Костов', note: 'зает външно в РИК 01' })
    expect(ledgerRow(raw, '30', 504)).toMatchObject({ holder: 'external', name: 'Без Номер Някои', note: 'в регистъра на РИК 30, Възможно съвпадение' })
    expect(ledgerRow(raw, '31', 520)).toMatchObject({ holder: 'external', name: '' })
    expect(nextIn(raw, '30')).toBe(505)
    expect(raw.prepare(`SELECT status FROM rik_status WHERE person_id = 'a1'`).get()).toEqual({ status: 'taken_external' })
    expect(raw.prepare(`SELECT status FROM rik_status WHERE person_id = 'r1'`).get()).toEqual({ status: 'registered' })
    expect(tasks(raw)).toEqual([
      { id: 'a1:call_rik:number_taken', type: 'call_rik', reason: 'number_taken', active: 0 },
      { id: 'a1:renumber:external', type: 'renumber', reason: 'external', active: 1 },
      { id: 'u1:possible_match:30/504', type: 'possible_match', reason: 'external', active: 1 },
    ])

    // The person gets a new number: the conflict and its task go, 01/515 stays taken (moved + external holder).
    raw.prepare(`UPDATE signups SET designation_number = 516 WHERE id = 'a1'`).run()
    const again = createRikSync(d1(raw), { trigger: 'manual', now: () => new Date('2026-10-29T20:00:00Z') })
    await again.rematch()
    expect(ledgerRow(raw, '01', 515)).toMatchObject({ holder: 'signup', state: 'moved', moved_to: '01/516', name: 'Пламен Стоянов Костов' })
    expect(tasks(raw).find((task) => task.id === 'a1:renumber:external')!.active).toBe(0)
    expect(raw.prepare(`SELECT status FROM rik_status WHERE person_id = 'a1'`).get()).toEqual({ status: 'not_signed' })
    // Same register again: nothing in the ledger changes.
    const snapshot = JSON.stringify(raw.prepare('SELECT * FROM designation_numbers ORDER BY mir, number').all())
    await createRikSync(d1(raw), { trigger: 'manual', now: () => new Date('2026-10-29T21:00:00Z') }).rematch()
    expect(JSON.stringify(raw.prepare('SELECT * FROM designation_numbers ORDER BY mir, number').all())).toBe(snapshot)
    // People are only ever read; the renumber above was ours.
    expect(JSON.stringify(raw.prepare(`SELECT * FROM signups WHERE id != 'a1' ORDER BY id`).all())).toBe(
      JSON.stringify((JSON.parse(before) as Array<{ id: string }>).filter((row) => row.id !== 'a1')),
    )
  })
})

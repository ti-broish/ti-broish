import { describe, expect, it } from 'vitest'
import { classifyAdminSearch } from './admin-search'
import { DESIGNATION_NUMBERS_TABLE } from './designation-numbers'
import {
  buildCards,
  LEDGER_PEOPLE_SQL,
  NUMBER_LOOKUP_SQL,
  parseNumberQuery,
  peopleFrom,
  PERSON_LEDGER_SQL,
  REGISTER_FOR_NUMBER_SQL,
  registerPresence,
  registerUrlsFrom,
  sortHistory,
  type LedgerRow,
  type RegisterRow,
} from './number-lookup'
import { nameKey } from './rik/normalize'
import { RIK_TABLES } from './rik/sql'

/** Fake names only. */
const ledger = (patch: Partial<LedgerRow>): LedgerRow => ({
  mir: '23', number: 514, issued_on: '22.10.2026', holder: 'signup', person_id: 'p1', state: 'active', moved_to: '', name: '', rik_url: '', note: '', created_at: '2026-10-29 18:06:32', ...patch,
})
const reg = (patch: Partial<RegisterRow>): RegisterRow => ({
  mir: '23', number: 514, name: 'Иван Петров Иванов', name_key: nameKey('Иван Петров Иванов'), annulled: 0, missing_since: null, source_url: 'https://rik23.cik.bg/pvr2026/registers/register_p?id=4', ...patch,
})

describe('number query', () => {
  it('„МИР/номер“ or a bare number; anything else is a normal search', () => {
    expect(parseNumberQuery('23/514')).toEqual({ mir: '23', number: 514 })
    expect(parseNumberQuery(' 1 / 515 ')).toEqual({ mir: '01', number: 515 })
    expect(parseNumberQuery('514')).toEqual({ mir: '', number: 514 })
    for (const other of ['', '0', '00/514', '23/0', '23/5140', '5140', 'Иван', '0888123456', '23/514 Иван', '8001010000']) expect(parseNumberQuery(other)).toBeNull()
  })

  it('leaves the existing search classifier alone (FTS search still runs next to the card)', () => {
    expect(classifyAdminSearch('23/514').kind).toBe('text')
    expect(classifyAdminSearch('514').kind).toBe('text')
    expect(classifyAdminSearch('0888123456').kind).toBe('phone')
  })
})

describe('register presence', () => {
  it('published, annulled, gone, not published, somebody else', () => {
    const key = nameKey('Иван Петров Иванов')
    expect(registerPresence('23', [reg({})], '', key)).toMatchObject({ state: 'published', label: 'в РИК 23: публикуван ✓' })
    expect(registerPresence('23', [reg({ name: 'Анулиран', name_key: 'анулиран', annulled: 1 }), reg({ missing_since: '2026-10-25' })], '', key)).toMatchObject({
      state: 'annulled',
      label: 'в РИК 23: „Анулиран“, редът с името изчезна',
      url: 'https://rik23.cik.bg/pvr2026/registers/register_p?id=4',
    })
    expect(registerPresence('23', [reg({ missing_since: '2026-10-25' })], '', key)).toMatchObject({ state: 'gone', label: 'в РИК 23: вече не е в регистъра' })
    expect(registerPresence('23', [], 'https://rik23.cik.bg/pvr2026/registers/register_p', key)).toMatchObject({
      state: 'not_published',
      label: 'в РИК 23: не е публикуван',
      url: 'https://rik23.cik.bg/pvr2026/registers/register_p',
    })
    expect(registerPresence('23', [reg({ name: 'Друг Човек Някой', name_key: nameKey('Друг Човек Някой') })], '', key).state).toBe('other')
  })
})

describe('cards and history', () => {
  const people = peopleFrom([
    { id: 'p1', source: 'partner', name: 'Иван  Петров Иванов', mir: '26', number: 525, signed_at: '2026-10-23T09:00:00Z' },
  ])
  const urls = registerUrlsFrom([{ mir: '01', base_url: 'https://rik01.cik.bg/pvr2026/' }])

  it('moved: our holder, where they are now, the register of the old МИР', () => {
    const [card] = buildCards([ledger({ state: 'moved', moved_to: '26/525' })], [], people, urls)
    expect(card).toMatchObject({ label: '23/514', state: 'moved', stateLabel: 'преместен', movedTo: '26/525', external: null, person: { source: 'partner', mir: '26', number: 525, name: 'Иван Петров Иванов' } })
    expect(card!.register.state).toBe('not_published')
  })

  it('external: only what the РИК publishes, with the register link', () => {
    const [card] = buildCards(
      [ledger({ mir: '01', number: 515, holder: 'external', person_id: null, state: 'external', name: 'Външен Човек Едно', rik_url: 'https://rik01.cik.bg/x' })],
      [reg({ mir: '01', number: 515, name: 'Външен Човек Едно', name_key: nameKey('Външен Човек Едно') })],
      people,
      urls,
    )
    expect(card).toMatchObject({ state: 'external', person: null, external: { name: 'Външен Човек Едно', url: 'https://rik01.cik.bg/x' } })
  })

  it('our moved number now held outside: both our holder and the external holder', () => {
    const [card] = buildCards(
      [ledger({ mir: '01', number: 515, state: 'moved', moved_to: '01/522', name: 'Външен Човек Едно', note: 'зает външно в РИК 01' })],
      [reg({ mir: '01', number: 515, name: 'Външен Човек Едно', name_key: nameKey('Външен Човек Едно') })],
      people,
      urls,
    )
    expect(card!.person?.id).toBe('p1')
    expect(card!.external?.name).toBe('Външен Човек Едно')
    expect(card!.register.state).toBe('other')
  })

  it('history is oldest first: numbers left behind, then the current one', () => {
    const rows = sortHistory([
      ledger({ mir: '26', number: 525, state: 'active', issued_on: '22.10.2026' }),
      ledger({ state: 'moved', moved_to: '26/525', issued_on: '22.10.2026' }),
      ledger({ mir: '23', number: 501, state: 'moved', moved_to: '23/514', issued_on: '9.10.2026' }),
    ])
    expect(rows.map((row) => `${row.mir}/${row.number}`)).toEqual(['23/501', '23/514', '26/525'])
  })
})

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): { run(...values: unknown[]): unknown; all(...values: unknown[]): unknown[] }
}
const sqliteModule = 'node:sqlite'
const sqlite = (await import(/* @vite-ignore */ sqliteModule).catch(() => null)) as { DatabaseSync: new (path: string) => SqliteDatabase } | null

describe.skipIf(!sqlite)('lookup SQL (SQLite, as D1)', () => {
  const raw = sqlite ? new sqlite.DatabaseSync(':memory:') : null
  if (raw) {
    raw.exec(DESIGNATION_NUMBERS_TABLE)
    for (const sql of RIK_TABLES) raw.exec(sql)
    raw.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, payload TEXT, designation_mir TEXT, designation_number INTEGER, designation_signed_at TEXT)`)
    raw.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, first_name TEXT, middle_name TEXT, last_name TEXT, designation_mir TEXT, designation_number INTEGER, designation_signed_at TEXT)`)
    raw.prepare(`INSERT INTO signups VALUES ('s1', ?, '26', 525, NULL)`).run(JSON.stringify({ firstName: 'Иван', middleName: 'Петров', lastName: 'Иванов' }))
    raw.prepare(`INSERT INTO partner_people VALUES ('pp1', 'Мария', 'Иванова', 'Петрова', '01', 522, '2026-10-29T10:00:00Z')`).run()
    const add = raw.prepare(`INSERT INTO designation_numbers (mir, number, holder, person_id, state, moved_to, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-29', '2026-10-29')`)
    add.run('23', 514, 'signup', 's1', 'moved', '26/525', '')
    add.run('26', 525, 'signup', 's1', 'active', '', '')
    add.run('01', 514, 'partner', 'x', 'active', '', '')
    add.run('01', 515, 'partner', 'pp1', 'moved', '01/522', 'Външен Човек Едно')
    raw.prepare(`INSERT INTO rik_entries (id, mir, kind, ours, party, source_url, name, name_key, number_raw, number, number_date, annulled, first_seen_at, last_seen_at)
      VALUES ('e1', '01', 'representative', 1, '', 'https://rik01/x', 'Външен Човек Едно', 'k', '515/23.10.2026', 515, '23.10.2026', 0, '2026-10-23', '2026-10-29'),
             ('e2', '01', 'representative', 0, '', 'https://rik01/x', 'Друга Партия', 'k2', '515/23.10.2026', 515, '23.10.2026', 0, '2026-10-23', '2026-10-29')`).run()
  }

  it('one МИР or every МИР; the person rows; only our coalition’s register rows', () => {
    expect(raw!.prepare(NUMBER_LOOKUP_SQL).all(514, '23')).toEqual([expect.objectContaining({ mir: '23', number: 514, state: 'moved' })])
    expect((raw!.prepare(NUMBER_LOOKUP_SQL).all(514, '') as LedgerRow[]).map((row) => row.mir)).toEqual(['01', '23'])
    expect((raw!.prepare(PERSON_LEDGER_SQL).all('s1') as LedgerRow[]).length).toBe(2)
    expect(raw!.prepare(REGISTER_FOR_NUMBER_SQL).all(515, '01')).toEqual([expect.objectContaining({ name: 'Външен Човек Едно' })])
    const people = raw!.prepare(LEDGER_PEOPLE_SQL).all(JSON.stringify(['s1', 'pp1', 'missing'])) as Array<{ id: string; source: string; name: string; number: number }>
    expect(people.map((one) => [one.id, one.source, one.name, one.number])).toEqual([
      ['s1', 'signup', 'Иван Петров Иванов', 525],
      ['pp1', 'partner', 'Мария Иванова Петрова', 522],
    ])
  })
})

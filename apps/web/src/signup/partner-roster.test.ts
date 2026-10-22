// „И аз“ rows on Записвания: shown once, merged with unfinished signups, never counted twice,
// and never in any Brevo, export or bulk path.
import { describe, expect, it } from 'vitest'
import { rosterWhere } from './admin-csv'
import { PARTNER_PEOPLE_TABLE, PARTNER_SECTION_COLUMNS, PARTNER_WITHDRAWAL_COLUMNS } from './partner-people-sql'
import {
  hidesMergedSignups,
  MERGED_SIGNUP_SQL,
  PARTNER_SHOWN_SQL,
  PARTNER_SUMMARY_SQL,
  partnerCountSql,
  partnerRowsSql,
  partnerSearchClause,
  partnerViewWhere,
  SIGNUP_HAS_PARTNER_SQL,
  unionPageSql,
} from './partner-roster'

type Stmt = { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown; run(...args: unknown[]): unknown }
type Db = { exec(sql: string): void; prepare(sql: string): Stmt }

async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

const sqlite = await openDb()

// ЕГН values are made up (only the shape matters here).
const INA_EGN = '9001016354'
const SONYA_EGN = '8805051234'
const TODOR_EGN = '7702021111'
const FIN_EGN = '6603033333'

function seed(db: Db) {
  db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, email TEXT, egn TEXT, payload TEXT, submitted INTEGER, email_confirmed INTEGER,
    withdrawn INTEGER, designation_number INTEGER, updated_at TEXT, mir_code TEXT, role TEXT, published_section TEXT, draft_section TEXT, region_code TEXT)`)
  db.exec(PARTNER_PEOPLE_TABLE)
  for (const sql of [...PARTNER_SECTION_COLUMNS, ...PARTNER_WITHDRAWAL_COLUMNS]) db.exec(sql)
  const signup = db.prepare('INSERT INTO signups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const payload = (first: string, last: string) => JSON.stringify({ firstName: first, lastName: last, phone: '0888123456' })
  // Ина: unfinished signup (not submitted, confirmed) with the same ЕГН as her „И аз“ row.
  signup.run('sig-ina', 'moutafchieva@gmail.com', INA_EGN, payload('Илина', 'Мутафчиева'), 0, 1, 0, null, '2026-10-20T10:00:00Z', '01', 'section', '', '', '01')
  // Ина's typo row: no ЕГН, e-mail does not match. Stays a separate, ordinary unfinished signup.
  signup.run('sig-ina-typo', 'moutafchieva@gmai', '', payload('Илина', 'Мутафчиева'), 0, 0, 0, null, '2026-10-19T10:00:00Z', '', '', '', '', '')
  // Соня: unfinished signup matching by e-mail (and ЕГН).
  signup.run('sig-sonya', 'sonya.georgieva@gmail.com', SONYA_EGN, payload('Соня', 'Георгиева'), 0, 1, 0, null, '2026-10-18T10:00:00Z', '04', '', '', '', '04')
  // A finished volunteer who is also in „И аз“: the signup stays, the partner row is not shown.
  signup.run('sig-finished', 'fin@example.com', FIN_EGN, payload('Финал', 'Готов'), 1, 1, 0, null, '2026-10-17T10:00:00Z', '23', 'section', '234600001', '', '23')
  // An ordinary unfinished signup with nothing to do with „И аз“.
  signup.run('sig-other', 'other@example.com', '', payload('Друг', 'Човек'), 0, 1, 0, null, '2026-10-16T10:00:00Z', '23', '', '', '', '23')
  // A withdrawn signup of a withdrawn partner.
  signup.run('sig-todor', 'todor@example.com', TODOR_EGN, payload('Тодор', 'Тодоров'), 1, 1, 1, null, '2026-10-15T10:00:00Z', '03', '', '', '', '03')

  const partner = db.prepare(`INSERT INTO partner_people (id, partner, egn, email, phone, first_name, middle_name, last_name, region_code, designation_mir,
    designation_number, designation_signed_at, imported_at, updated_at, section_draft, section_published, withdrawn_at) VALUES (?, 'iaz.bg', ?, ?, '', ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  partner.run('pp-ina', INA_EGN, 'moutafchieva@gmail.com', 'Илина', 'Мутафчиева', '25', '25', 506, '2026-10-21T07:22:43Z', '2026-10-19T20:44:21Z', '2026-10-21T21:12:47Z', '254618054', '254618054', null)
  partner.run('pp-sonya', '0000000000', 'Sonya.Georgieva@gmail.com ', 'Соня', 'Георгиева', '04', '04', 503, '2026-10-21T08:00:00Z', '2026-10-19T20:44:21Z', '2026-10-21T10:00:00Z', '040400134', '040400134', null)
  partner.run('pp-fin', FIN_EGN, 'fin-iaz@example.com', 'Финал', 'Готов', '23', '23', 510, null, '2026-10-19T20:44:21Z', '2026-10-21T10:00:00Z', '', '', null)
  partner.run('pp-todor', TODOR_EGN, 'todor@example.com', 'Тодор', 'Тодоров', '03', '03', 515, '2026-10-21T08:00:00Z', '2026-10-19T20:44:21Z', '2026-10-21T10:00:00Z', '', '', '2026-10-21T11:00:00Z')
  partner.run('pp-solo', '5504044444', 'solo@example.com', 'Само', 'Иаз', '23', '23', 511, null, '2026-10-19T20:44:21Z', '2026-10-22T10:00:00Z', '234600002', '', null)
}

const ids = (rows: unknown[]) => (rows as Array<{ id: string }>).map((row) => row.id).sort()

describe.skipIf(!sqlite)('„И аз“ on Записвания (SQLite)', () => {
  const db = sqlite!
  seed(db)

  it('merges only unfinished signups that really match an active „И аз“ row (Ина, Соня; not the typo row)', () => {
    expect(ids(db.prepare(`SELECT id FROM signups WHERE ${MERGED_SIGNUP_SQL}`).all())).toEqual(['sig-ina', 'sig-sonya'])
  })

  it('shows a partner row unless it is withdrawn or a finished volunteer is the same person', () => {
    expect(ids(db.prepare(`SELECT p.id AS id FROM partner_people p WHERE ${PARTNER_SHOWN_SQL}`).all())).toEqual(['pp-ina', 'pp-solo', 'pp-sonya'])
  })

  it('pages signups and partner rows together with one row per person (no duplicates)', () => {
    const all = rosterWhere('all', '') as { clause: string; binds: string[] }
    const signupClause = `(${all.clause}) AND NOT ${MERGED_SIGNUP_SQL}`
    const page = db.prepare(unionPageSql(signupClause, '1 = 1', 'updated', 'desc')).all(50, 0) as Array<{ id: string; kind: number }>
    expect(page.map((row) => row.id)).toEqual(['pp-solo', 'pp-ina', 'pp-sonya', 'sig-ina-typo', 'sig-finished', 'sig-other', 'sig-todor'])
    expect(page.filter((row) => row.kind === 1).map((row) => row.id)).toEqual(['pp-solo', 'pp-ina', 'pp-sonya'])
    const signupCount = (db.prepare(`SELECT COUNT(*) AS n FROM signups WHERE ${signupClause}`).get() as { n: number }).n
    const partnerCount = (db.prepare(partnerCountSql('1 = 1')).get() as { n: number }).n
    expect(signupCount + partnerCount).toBe(page.length)
  })

  it('the partner row carries its own section, number and signed state, and links the merged signup', () => {
    const rows = db.prepare(partnerRowsSql(2, false)).all('pp-ina', 'pp-solo') as Array<Record<string, unknown>>
    const ina = rows.find((row) => row.id === 'pp-ina')!
    expect(ina).toMatchObject({ designation_mir: '25', designation_number: 506, section_published: '254618054', merged_signup_id: 'sig-ina', egn: '' })
    expect(ina.designation_signed_at).toBeTruthy()
    // The phone comes from the merged signup when „И аз“ has none.
    expect(ina.merged_signup_phone).toBe('0888123456')
    expect(rows.find((row) => row.id === 'pp-solo')!.merged_signup_id).toBeNull()
  })

  it('counts stay right: partners in total, assigned and unassigned, merged signups not in started', () => {
    const summary = db.prepare(PARTNER_SUMMARY_SQL).get() as { partners: number; assigned: number }
    expect(summary).toEqual({ partners: 3, assigned: 2 })
    const started = rosterWhere('started', '') as { clause: string }
    expect(ids(db.prepare(`SELECT id FROM signups WHERE (${started.clause}) AND NOT ${MERGED_SIGNUP_SQL}`).all())).toEqual(['sig-ina-typo', 'sig-other'])
  })

  it('marks finished volunteers who also have an active „И аз“ row (a withdrawn one does not count)', () => {
    expect(ids(db.prepare(`SELECT id FROM signups WHERE COALESCE(submitted, 0) = 1 AND ${SIGNUP_HAS_PARTNER_SQL}`).all())).toEqual(['sig-finished'])
  })

  it('partner views and search', () => {
    const run = (view: string, mir: string, q: string) => {
      const where = partnerViewWhere(view, mir)
      if (!where) return null
      const search = partnerSearchClause(q)
      return ids(db.prepare(`SELECT p.id AS id FROM partner_people p WHERE ${PARTNER_SHOWN_SQL} AND (${where.clause}) AND (${search.clause})`).all(...where.binds, ...search.binds))
    }
    expect(run('assigned', '', '')).toEqual(['pp-ina', 'pp-sonya'])
    expect(run('unassigned', '', '')).toEqual(['pp-solo'])
    expect(run('draft', '', '')).toEqual(['pp-solo'])
    expect(run('mir', '25', '')).toEqual(['pp-ina'])
    expect(run('mir', '4', '')).toEqual(['pp-sonya'])
    expect(run('finished', '', '')).toBeNull()
    expect(run('started', '', '')).toBeNull()
    expect(run('withdrawn', '', '')).toBeNull()
    expect(run('calls', '', '')).toBeNull()
    expect(run('all', '', 'мутафчиева')).toEqual(['pp-ina'])
    expect(run('all', '', 'Илина Мутафчиева')).toEqual(['pp-ina'])
    expect(run('all', '', INA_EGN)).toEqual(['pp-ina'])
    expect(run('all', '', 'sonya.georgieva@gmail.com')).toEqual(['pp-sonya'])
    expect(run('all', '', '254618054')).toEqual(['pp-ina'])
  })
})

describe('no Brevo for „И аз“ or merged signups', () => {
  it('exports and Brevo always hide merged signups, in every view', () => {
    for (const view of ['all', 'finished', 'started', 'assigned', 'unassigned', 'draft', 'abroad', 'mir', 'calls', 'queue', 'withdrawn']) {
      expect(hidesMergedSignups(view, true)).toBe(true)
    }
    // The call queues are about the signup itself, so a merged signup that asked for a call stays there.
    expect(hidesMergedSignups('calls')).toBe(false)
    expect(hidesMergedSignups('queue')).toBe(false)
    expect(hidesMergedSignups('all')).toBe(true)
  })

  it.skipIf(!sqlite)('a Brevo scope over signups never returns a merged signup or a partner id', () => {
    const db = sqlite!
    for (const view of ['all', 'started', 'unassigned', 'mir'] as const) {
      const where = rosterWhere(view, '25') as { clause: string; binds: string[] }
      const found = ids(db.prepare(`SELECT id FROM signups WHERE (${where.clause}) AND NOT ${MERGED_SIGNUP_SQL}`).all(...where.binds))
      expect(found).not.toContain('sig-ina')
      expect(found).not.toContain('sig-sonya')
      expect(found.some((id) => id.startsWith('pp-'))).toBe(false)
    }
  })

  it.skipIf(!sqlite)('a merged signup has no пълномощно number, so the „all signed“ Brevo resync (signed file = numbered) never sees one', () => {
    const db = sqlite!
    expect(ids(db.prepare(`SELECT id FROM signups WHERE ${MERGED_SIGNUP_SQL} AND designation_number IS NOT NULL`).all())).toEqual([])
    db.exec("UPDATE signups SET designation_number = 999 WHERE id = 'sig-sonya'")
    expect(ids(db.prepare(`SELECT id FROM signups WHERE ${MERGED_SIGNUP_SQL}`).all())).toEqual(['sig-ina'])
    db.exec("UPDATE signups SET designation_number = NULL WHERE id = 'sig-sonya'")
  })
})

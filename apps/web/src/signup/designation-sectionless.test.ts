import { describe, expect, it } from 'vitest'
import { DESIGNATION_ASSIGN_SQL } from './designation-number'
import { SIGNUP_DESIGNATION_SECTION_SQL } from './designation-section-sql'
import { NO_MIR_REASON, SECTIONLESS_SIGNUPS_SQL, SOFIA_NO_DISTRICT_REASON, sectionlessMir } from './designation-sectionless'

describe('sectionlessMir', () => {
  it('takes the draft section МИР first', () => {
    expect(sectionlessMir({ draft_section: '061100045', mir_code: '05', region_code: '05' })).toEqual({ mir: '06', reason: null })
  })
  it('falls back to the home МИР (mir_code), padded', () => {
    expect(sectionlessMir({ draft_section: '', mir_code: '26', region_code: '26' })).toEqual({ mir: '26', reason: null })
    expect(sectionlessMir({ draft_section: null, mir_code: '2', region_code: '02' })).toEqual({ mir: '02', reason: null })
  })
  it('uses a Sofia district МИР when the profile has it', () => {
    expect(sectionlessMir({ mir_code: '24', region_code: 'sofia-merged' })).toEqual({ mir: '24', reason: null })
  })
  it('never guesses 23/24/25 for София без район', () => {
    expect(sectionlessMir({ mir_code: '', region_code: 'sofia-merged' })).toEqual({ mir: '', reason: SOFIA_NO_DISTRICT_REASON })
  })
  it('reports a missing or unknown МИР', () => {
    expect(sectionlessMir({ mir_code: '', region_code: '' })).toEqual({ mir: '', reason: NO_MIR_REASON })
    expect(sectionlessMir({ mir_code: '99', region_code: 'x' })).toEqual({ mir: '', reason: NO_MIR_REASON })
  })
})

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

describe.skipIf(!sqlite)('SECTIONLESS_SIGNUPS_SQL (SQLite, as D1)', () => {
  function seed() {
    const db = sqlite!
    db.exec('DROP TABLE IF EXISTS signups')
    db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, email TEXT, payload TEXT, egn TEXT, submitted INTEGER, email_confirmed INTEGER,
      withdrawn INTEGER NOT NULL DEFAULT 0, published_section TEXT, draft_section TEXT, mir_code TEXT, region_code TEXT, created_at TEXT, updated_at TEXT,
      designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT)`)
    db.exec('DROP TABLE IF EXISTS partner_people')
    db.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, egn TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', withdrawn_at TEXT,
      designation_mir TEXT, designation_number INTEGER, covered_by_signup_id TEXT)`)
    db.exec('DROP TABLE IF EXISTS designation_high_water')
    db.exec('CREATE TABLE designation_high_water (mir TEXT PRIMARY KEY, n INTEGER NOT NULL)')
    const add = db.prepare(`INSERT INTO signups (id, email, payload, egn, submitted, email_confirmed, withdrawn, published_section, draft_section, mir_code, region_code, created_at, designation_number)
      VALUES (?, ?, '{"firstName":"А","lastName":"Б"}', ?, ?, 1, ?, ?, '', ?, ?, '2026-10-23', ?)`)
    add.run('home', 'a@x.bg', '6403271953', 1, 0, '', '06', '06', null) // finished, no section → МИР 06
    add.run('sofia', 'b@x.bg', '7408242008', 1, 0, '', '', 'sofia-merged', null) // finished, София без район
    add.run('sectioned', 'c@x.bg', '6809221872', 1, 0, '061100045', '06', '06', null) // has a section: the old path
    add.run('started', 'd@x.bg', '7101221954', 0, 0, '', '02', '02', null) // not finished
    add.run('gone', 'e@x.bg', '7408040650', 1, 1, '', '02', '02', null) // withdrawn
    add.run('numbered', 'f@x.bg', '6103030549', 1, 0, '', '02', '02', 501) // already numbered
    return db
  }

  it('lists only finished, active, unnumbered volunteers without a published section', () => {
    const db = seed()
    const ids = (db.prepare(SECTIONLESS_SIGNUPS_SQL).all() as Array<{ id: string }>).map((row) => row.id).sort()
    expect(ids).toEqual(['home', 'sofia'])
  })

  it('once numbered by МИР, the volunteer is listed for the пълномощно without a section', () => {
    const db = seed()
    db.prepare(DESIGNATION_ASSIGN_SQL).run('06', '23.10.2026', 'now', 'home')
    const row = db.prepare(`SELECT designation_mir, designation_number, ${SIGNUP_DESIGNATION_SECTION_SQL} AS section FROM signups WHERE id = 'home'`).all()[0]
    expect(row).toEqual({ designation_mir: '06', designation_number: 501, section: '06' })
    const ids = (db.prepare(SECTIONLESS_SIGNUPS_SQL).all() as Array<{ id: string }>).map((r) => r.id)
    expect(ids).toEqual(['sofia'])
  })

  it('the ЕГН guard still blocks a second number for the same person', () => {
    const db = seed()
    db.prepare(`UPDATE signups SET egn = '6103030549' WHERE id = 'home'`).run()
    const result = db.prepare(DESIGNATION_ASSIGN_SQL).run('06', '23.10.2026', 'now', 'home')
    expect(Number(result.changes)).toBe(0)
  })
})

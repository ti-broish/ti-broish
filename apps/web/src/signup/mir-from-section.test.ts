import { describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({ env: {} }))

import { applySignupSchema, type SignupD1 } from './db-core'
import { RERUN_WRITE_DRAFT_SQL } from './distribute-rerun-sql'
import { DESIGNATION_HIGH_WATER_TABLE, DESIGNATION_HIGH_WATER_TRIGGERS, DESIGNATION_ASSIGN_SQL } from './designation-number'
import { MIR_FROM_SECTION_ACTOR, MIR_FROM_SECTION_BACKFILL, MIR_FROM_SECTION_TRIGGERS, sectionMir } from './mir-from-section'
import { auditLines, describeAudit } from './admin-audit'

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

function seed(withTriggers = true) {
  const db = sqlite!
  for (const t of ['signups', 'partner_people', 'signup_audit', 'designation_high_water']) db.exec(`DROP TABLE IF EXISTS ${t}`)
  db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, mir_code TEXT, region_code TEXT, draft_section TEXT, published_section TEXT,
    designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, egn TEXT, withdrawn INTEGER NOT NULL DEFAULT 0, updated_at TEXT)`)
  db.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, egn TEXT NOT NULL DEFAULT '', designation_mir TEXT, designation_number INTEGER,
    section_draft TEXT, section_published TEXT, covered_by_signup_id TEXT, withdrawn_at TEXT, updated_at TEXT)`)
  db.exec('CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT NOT NULL, actor TEXT NOT NULL, field TEXT NOT NULL, before_text TEXT NOT NULL, after_text TEXT NOT NULL, created_at TEXT NOT NULL)')
  db.exec(DESIGNATION_HIGH_WATER_TABLE)
  for (const sql of DESIGNATION_HIGH_WATER_TRIGGERS) db.exec(sql)
  if (withTriggers) for (const sql of MIR_FROM_SECTION_TRIGGERS) db.exec(sql)
  return db
}

const signup = (db: Db, id: string) => db.prepare('SELECT * FROM signups WHERE id = ?').get(id) as Record<string, unknown>
const partner = (db: Db, id: string) => db.prepare('SELECT * FROM partner_people WHERE id = ?').get(id) as Record<string, unknown>
const audit = (db: Db, id: string) => db.prepare('SELECT actor, field, before_text, after_text FROM signup_audit WHERE signup_id = ? ORDER BY created_at, rowid').all(id)

describe('sectionMir', () => {
  it('reads the first two digits of a section code', () => {
    expect(sectionMir('254611060')).toBe('25')
    expect(sectionMir('320100001')).toBe('32')
    expect(sectionMir(' 011800001 ')).toBe('01')
    expect(sectionMir('')).toBe('')
    expect(sectionMir(null)).toBe('')
    expect(sectionMir('25')).toBe('')
  })
})

describe.skipIf(!sqlite)('МИР follows the section (SQLite triggers, as D1)', () => {
  it('fills an empty signup МИР when a draft section is set (Софии без район), with one audit line', () => {
    const db = seed()
    db.prepare("INSERT INTO signups (id, region_code, updated_at) VALUES ('s1', 'sofia-merged', 't0')").run()
    db.prepare("UPDATE signups SET draft_section = '254611060', updated_at = 't1' WHERE id = 's1'").run()
    expect(signup(db, 's1')).toMatchObject({ mir_code: '25', updated_at: 't1' })
    expect(audit(db, 's1')).toEqual([{ actor: MIR_FROM_SECTION_ACTOR, field: 'mir', before_text: '—', after_text: '25' }])
  })

  it('fills from a published section, on insert (imports), and abroad (32)', () => {
    const db = seed()
    db.prepare("INSERT INTO signups (id, published_section, updated_at) VALUES ('s2', '321000045', 't0')").run()
    expect(signup(db, 's2').mir_code).toBe('32')
    expect(audit(db, 's2')).toHaveLength(1)
  })

  it('keeps a different home МИР (allocator reach) and never touches designation_mir/number', () => {
    const db = seed()
    db.prepare("INSERT INTO signups (id, mir_code, designation_mir, designation_number, updated_at) VALUES ('s3', '16', '16', 505, 't0')").run()
    db.prepare("UPDATE signups SET draft_section = '170100001' WHERE id = 's3'").run()
    expect(signup(db, 's3')).toMatchObject({ mir_code: '16', designation_mir: '16', designation_number: 505 })
    expect(audit(db, 's3')).toEqual([])
  })

  it('restores the МИР when a profile save recomputes it to nothing, without a second audit line', () => {
    const db = seed()
    db.prepare("INSERT INTO signups (id, draft_section, updated_at) VALUES ('s4', '254611060', 't0')").run()
    db.prepare("UPDATE signups SET mir_code = NULL WHERE id = 's4'").run()
    expect(signup(db, 's4').mir_code).toBe('25')
    expect(audit(db, 's4')).toHaveLength(1)
  })

  it('clearing a section keeps the МИР; numbering still uses the app SQL', () => {
    const db = seed()
    db.prepare("INSERT INTO signups (id, draft_section, egn, updated_at) VALUES ('s5', '254611060', '1', 't0')").run()
    db.prepare("UPDATE signups SET draft_section = NULL WHERE id = 's5'").run()
    expect(signup(db, 's5').mir_code).toBe('25')
    db.prepare(DESIGNATION_ASSIGN_SQL).run('25', '29.10.2026', 't2', 's5')
    expect(signup(db, 's5')).toMatchObject({ designation_mir: '25', designation_number: 501, mir_code: '25' })
  })

  it('an unnumbered „И аз“ row follows its own section (draft, then published), with audit', () => {
    const db = seed()
    db.prepare("INSERT INTO partner_people (id, designation_mir, updated_at) VALUES ('pp-1', '23', 't0')").run()
    db.prepare("UPDATE partner_people SET section_draft = '254611060' WHERE id = 'pp-1'").run()
    expect(partner(db, 'pp-1').designation_mir).toBe('25')
    db.prepare("UPDATE partner_people SET section_published = '240100002' WHERE id = 'pp-1'").run()
    expect(partner(db, 'pp-1').designation_mir).toBe('24')
    expect(audit(db, 'pp-1')).toEqual([
      { actor: MIR_FROM_SECTION_ACTOR, field: 'mir', before_text: '23', after_text: '25' },
      { actor: MIR_FROM_SECTION_ACTOR, field: 'mir', before_text: '25', after_text: '24' },
    ])
  })

  it('never moves a numbered or withdrawn „И аз“ row', () => {
    const db = seed()
    db.prepare("INSERT INTO partner_people (id, designation_mir, designation_number, updated_at) VALUES ('pp-n', '23', 507, 't0')").run()
    db.prepare("INSERT INTO partner_people (id, designation_mir, withdrawn_at, updated_at) VALUES ('pp-w', '23', 'x', 't0')").run()
    db.prepare("UPDATE partner_people SET section_draft = '254611060'").run()
    expect(partner(db, 'pp-n')).toMatchObject({ designation_mir: '23', designation_number: 507 })
    expect(partner(db, 'pp-w').designation_mir).toBe('23')
    expect(audit(db, 'pp-n')).toEqual([])
  })

  it('a covered „И аз“ row without its own section follows the covering volunteer (section, then number)', () => {
    const db = seed()
    db.prepare("INSERT INTO signups (id, mir_code, updated_at) VALUES ('keep', '16', 't0')").run()
    db.prepare("INSERT INTO partner_people (id, covered_by_signup_id, updated_at) VALUES ('pp-c', 'keep', 't0')").run()
    expect(partner(db, 'pp-c').designation_mir).toBeNull()
    db.prepare("UPDATE signups SET published_section = '320500010' WHERE id = 'keep'").run()
    expect(partner(db, 'pp-c').designation_mir).toBe('32')
    // Numbered cross-МИР: the number's МИР is what „covered in the same МИР“ compares against.
    db.prepare("UPDATE signups SET designation_mir = '31', designation_number = 501 WHERE id = 'keep'").run()
    expect(partner(db, 'pp-c').designation_mir).toBe('31')
    // Own section wins over the covering volunteer.
    db.prepare("UPDATE partner_people SET section_draft = '254611060' WHERE id = 'pp-c'").run()
    expect(partner(db, 'pp-c').designation_mir).toBe('25')
    expect((audit(db, 'pp-c') as Array<{ after_text: string }>).map((row) => row.after_text)).toEqual(['32', '31', '25'])
  })

  it('a newly covered row picks the covering volunteer up on insert and on the cover mark', () => {
    const db = seed()
    db.prepare("INSERT INTO signups (id, draft_section, updated_at) VALUES ('keep', '254611060', 't0')").run()
    db.prepare("INSERT INTO partner_people (id, covered_by_signup_id, updated_at) VALUES ('pp-i', 'keep', 't0')").run()
    db.prepare("INSERT INTO partner_people (id, updated_at) VALUES ('pp-m', 't0')").run()
    db.prepare("UPDATE partner_people SET covered_by_signup_id = 'keep' WHERE id = 'pp-m'").run()
    expect(partner(db, 'pp-i').designation_mir).toBe('25')
    expect(partner(db, 'pp-m').designation_mir).toBe('25')
  })

  it('backfill applies the same rules to old rows, once', () => {
    const db = seed(false)
    db.prepare("INSERT INTO signups (id, draft_section, updated_at) VALUES ('a', '254611060', 't0')").run()
    db.prepare("INSERT INTO signups (id, mir_code, draft_section, updated_at) VALUES ('b', '16', '170100001', 't0')").run()
    db.prepare("INSERT INTO partner_people (id, covered_by_signup_id, updated_at) VALUES ('pp-a', 'a', 't0')").run()
    db.prepare("INSERT INTO partner_people (id, designation_mir, designation_number, section_draft, updated_at) VALUES ('pp-n', '23', 501, '254611060', 't0')").run()
    for (let pass = 0; pass < 2; pass++) for (const sql of MIR_FROM_SECTION_BACKFILL) db.exec(sql)
    expect(signup(db, 'a').mir_code).toBe('25')
    expect(signup(db, 'b').mir_code).toBe('16')
    expect(partner(db, 'pp-a').designation_mir).toBe('25')
    expect(partner(db, 'pp-n').designation_mir).toBe('23')
    expect(db.prepare('SELECT COUNT(*) AS n FROM signup_audit').get()).toEqual({ n: 2 })
  })
})

describe('МИР audit line', () => {
  it('is shown on the person page', () => {
    expect(describeAudit('mir', '—', '25')).toBe('МИР: — → 25')
    expect(auditLines([{ id: '1', actor: MIR_FROM_SECTION_ACTOR, field: 'mir', before_text: '—', after_text: '25', created_at: 't' }])).toHaveLength(1)
  })
})

function asD1(db: Db): SignupD1 {
  const statement = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => (db.prepare(sql).get(...args) ?? null) as T | null,
    all: async <T>() => ({ results: db.prepare(sql).all(...args) as T[] }),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  })
  return { prepare: (sql: string) => statement(sql), exec: async (sql: string) => db.exec(sql) } as unknown as SignupD1
}

describe.skipIf(!sqlite)('the app schema installs the triggers', () => {
  it('an allocator draft on a real schema fills the МИР, audited', async () => {
    const raw = sqlite!
    for (const { name } of raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>) {
      raw.exec(`DROP TABLE IF EXISTS "${name}"`)
    }
    await applySignupSchema(asD1(raw))
    const triggers = (raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE '%mir_from_section%' OR name LIKE '%mir_to_covered%')`).all() as Array<{ name: string }>).map((row) => row.name)
    expect(triggers.sort()).toEqual([
      'trg_partner_people_mir_from_section_insert', 'trg_partner_people_mir_from_section_update',
      'trg_signups_mir_from_section_insert', 'trg_signups_mir_from_section_update', 'trg_signups_mir_to_covered_partners',
    ])
    raw.prepare(`INSERT INTO signups (id, email, session_token, payload, submitted, role, region_code, created_at, updated_at)
      VALUES ('v1', 'v1@example.test', 'tok', '{}', 1, 'mobile', 'sofia-merged', 't0', 't0')`).run()
    raw.prepare(RERUN_WRITE_DRAFT_SQL).run('254611060', 't1', 'v1', 0)
    expect(raw.prepare(`SELECT mir_code, updated_at FROM signups WHERE id = 'v1'`).get()).toEqual({ mir_code: '25', updated_at: 't1' })
    expect(raw.prepare(`SELECT field, before_text, after_text FROM signup_audit WHERE signup_id = 'v1'`).all()).toEqual([{ field: 'mir', before_text: '—', after_text: '25' }])
  })
})

describe('sql/ files', () => {
  it('carry exactly the triggers and the backfill the code uses', async () => {
    const { readFileSync } = await import('node:fs')
    const triggers = readFileSync(new URL('../../sql/2026-10-29-mir-from-section.sql', import.meta.url), 'utf8')
    const backfill = readFileSync(new URL('../../sql/2026-10-29-mir-from-section-backfill.sql', import.meta.url), 'utf8')
    for (const sql of MIR_FROM_SECTION_TRIGGERS) expect(triggers).toContain(`${sql};`)
    for (const sql of MIR_FROM_SECTION_BACKFILL) expect(backfill).toContain(`${sql};`)
  })
})

// „И аз“ partner sections: the allocator, the one-quota triggers, the „И аз“ reservation and
// the guarantee that no email or Brevo path ever sees a partner person.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { MOBILE_DRAFTS_GUARDS, MOBILE_DRAFTS_TABLE } from './mobile-teams-sql'
import {
  PARTNER_PEOPLE_TABLE,
  PARTNER_RESERVATION_ORG,
  PARTNER_SECTION_COLUMNS,
  PARTNER_SECTION_GUARDS,
} from './partner-people-sql'
import {
  PARTNER_BLOCKED_SQL,
  PARTNER_DRAFT_WRITE_SQL,
  blockedCodes,
  municipalityCodeOf,
  planPartnerDistribution,
  planPartnerSections,
  partnerReachMirs,
  priorityCandidates,
  rankForPerson,
  type PartnerCandidate,
  type PartnerSectionPerson,
} from './partner-sections'
import { RESERVED_SECTION_GUARDS } from './reserved-sections-sql'
import { planReservations } from './reserved-sections'

vi.mock('cloudflare:workers', () => ({ env: {} }))
vi.mock('@tanstack/react-start/server', () => ({ getCookie: () => '' }))

const person = (over: Partial<PartnerSectionPerson> = {}): PartnerSectionPerson => ({
  id: 'pp-1',
  mir: '02',
  regionCode: '02',
  municipality: 'Бургас',
  note: '',
  draft: '',
  published: '',
  ...over,
})

const priority = priorityCandidates([
  { section_code: '020400001', town: 'Бургас', municipality: 'Бургас', r: 5, level: 'watch' },
  { section_code: '020400002', town: 'Бургас', municipality: 'Бургас', r: 9, level: 'elevated' },
  { section_code: '020100001', town: 'Айтос', municipality: 'Айтос', r: 20, level: 'quarantine' },
  { section_code: '030600001', town: 'Варна', municipality: 'Варна', r: 30, level: 'quarantine' },
])

describe('partner allocator', () => {
  it('maps the named municipality to its code', () => {
    expect(municipalityCodeOf(person())).toBe('04')
    expect(municipalityCodeOf(person({ regionCode: 'sofia-merged', mir: '24', municipality: 'Столична' }))).toBe('46')
    expect(municipalityCodeOf(person({ municipality: '' }))).toBe('')
  })

  it('keeps the МИР, takes the municipality first and priority by R desc', () => {
    const plan = planPartnerSections({ people: [person(), person({ id: 'pp-2' })], candidates: priority, blocked: new Set() })
    expect(plan.drafts.map((row) => row.code)).toEqual(['020400002', '020400001'])
    expect(plan.drafts.every((row) => row.code.startsWith('02'))).toBe(true)
    // A third person falls back to the rest of the МИР, never to another МИР.
    const three = planPartnerSections({ people: [person(), person({ id: 'pp-2' }), person({ id: 'pp-3' })], candidates: priority, blocked: new Set() })
    expect(three.drafts.map((row) => [row.code, row.scope])).toContainEqual(['020100001', 'mir'])
  })

  it('never offers a held section, and skips people who already have one', () => {
    const plan = planPartnerSections({
      people: [person(), person({ id: 'pp-2', draft: '020100001' }), person({ id: 'pp-3', mir: '' })],
      candidates: priority,
      blocked: new Set(['020400002', '020400001']),
    })
    expect(plan.drafts).toEqual([expect.objectContaining({ personId: 'pp-1', code: '020100001' })])
    expect(plan.skipped.map((row) => row.reason).sort()).toEqual(['has-section', 'no-mir'])
  })

  it('reports people with no open section in their МИР', () => {
    const plan = planPartnerSections({ people: [person({ mir: '10', regionCode: '10', municipality: 'Трекляно' })], candidates: priority, blocked: new Set() })
    expect(plan.skipped).toEqual([{ personId: 'pp-1', mir: '10', reason: 'no-section' }])
  })

  it('uses ordinary sections only when paper or unknown, after local priority, and spreads addresses', () => {
    const ordinary: PartnerCandidate[] = [
      { code: '020400101', town: '', municipality: 'Бургас', place: 'Училище А', priority: null, isMachine: true, votersCount: 600 },
      { code: '020400102', town: '', municipality: 'Бургас', place: 'Училище А', priority: null, isMachine: false, votersCount: 200 },
      { code: '020400103', town: '', municipality: 'Бургас', place: 'Училище А', priority: null, isMachine: false, votersCount: 200 },
      { code: '020400104', town: '', municipality: 'Бургас', place: 'Училище Б', priority: null, isMachine: false, votersCount: 200 },
    ]
    const blocked = new Set(['020400001', '020400002'])
    const plan = planPartnerSections({ people: [person(), person({ id: 'pp-2' })], candidates: [...priority, ...ordinary], blocked })
    const codes = plan.drafts.map((row) => row.code)
    expect(codes).not.toContain('020400101')
    expect(codes).toEqual(['020400102', '020400104'])
  })

  it('a re-suggest does not count the person’s own draft as held', () => {
    const rows = [
      { code: '020400002', src: 'partner:pp-1' },
      { code: '020400001', src: 'signup' },
    ]
    expect([...blockedCodes(rows, 'pp-1')]).toEqual(['020400001'])
    const options = rankForPerson(person(), priority, blockedCodes(rows, 'pp-1')).map((row) => row.candidate.code)
    expect(options[0]).toBe('020400002')
  })
})

describe('reserved import never overwrites „И аз“', () => {
  const existing = [
    { sectionCode: '020400001', organisation: PARTNER_RESERVATION_ORG },
    { sectionCode: '020400009', organisation: 'ГЕРБ' },
  ]
  it('skips codes reserved by „И аз“ or held by a partner draft', () => {
    const plan = planReservations({
      csv: 'section,org\n020400001,ГЕРБ\n020400002,ГЕРБ\n020400003,ГЕРБ',
      formOrg: '',
      mode: 'merge',
      existing,
      people: [],
      isKnown: () => true,
      managed: new Set(['020400002']),
    })
    expect(plan.managed.map((row) => row.sectionCode)).toEqual(['020400001', '020400002'])
    expect(plan.add.map((row) => row.sectionCode)).toEqual(['020400003'])
    expect(plan.moved).toEqual([])
  })
  it('refuses a file for „И аз“ and never removes its rows on replace', () => {
    const own = planReservations({ csv: 'section\n020400005', formOrg: 'И аз', mode: 'replace', existing, people: [], isKnown: () => true })
    expect(own.errors.join(' ')).toMatch(/„И аз“/)
    const rows = planReservations({ csv: 'section,org\n020400005,„И аз“', formOrg: '', mode: 'merge', existing, people: [], isKnown: () => true })
    expect(rows.errors.join(' ')).toMatch(/„И аз“/)
    const replace = planReservations({ csv: 'section\n020400006', formOrg: 'ГЕРБ', mode: 'replace', existing, people: [], isKnown: () => true })
    expect(replace.remove.map((row) => row.sectionCode)).toEqual(['020400009'])
  })
})

type Statement = { run(...args: unknown[]): { changes: number | bigint }; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }
type Db = { exec(sql: string): void; prepare(sql: string): Statement }
async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

function schema(db: Db) {
  db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, email TEXT, withdrawn INTEGER DEFAULT 0, draft_section TEXT, published_section TEXT)`)
  db.exec('CREATE TABLE taken_sections (section_code TEXT PRIMARY KEY, mir_code TEXT, place TEXT, organisation TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL)')
  db.exec(PARTNER_PEOPLE_TABLE)
  for (const sql of PARTNER_SECTION_COLUMNS) db.exec(sql)
  for (const sql of RESERVED_SECTION_GUARDS) db.exec(sql)
  db.exec(MOBILE_DRAFTS_TABLE)
  for (const sql of MOBILE_DRAFTS_GUARDS) db.exec(sql)
  for (const sql of PARTNER_SECTION_GUARDS) db.exec(sql)
  const add = db.prepare(
    `INSERT INTO partner_people (id, partner, egn, designation_mir, imported_at, updated_at) VALUES (?, 'i-az', ?, '02', 'now', 'now')`,
  )
  add.run('pp-a', '1')
  add.run('pp-b', '2')
  db.prepare(`INSERT INTO signups (id, email, draft_section, published_section) VALUES ('s1', 's1@example.com', '020400001', NULL)`).run()
  db.prepare(`INSERT INTO signups (id, email, draft_section, published_section) VALUES ('s2', 's2@example.com', NULL, '020400002')`).run()
  db.prepare(`INSERT INTO taken_sections (section_code, organisation, created_at) VALUES ('020400003', 'ГЕРБ', 'now')`).run()
  db.prepare(
    `INSERT INTO mobile_drafts (signup_id, team_key, mir_code, municipality_code, area_key, area_label, targets, created_at, updated_at)
     VALUES ('s3', 's3', '02', '04', '02:04', 'x', '[{"code":"020400004","r":4,"level":"watch","town":""}]', 'now', 'now')`,
  ).run()
}

/** D1-shaped adapter over node:sqlite, enough for publishStatements and batch(). */
function d1(db: Db) {
  return {
    prepare(sql: string) {
      return {
        bind: (...values: unknown[]) => ({ sql, values }),
      }
    },
    batch(statements: Array<{ sql: string; values: unknown[] }>) {
      db.exec('BEGIN')
      try {
        for (const statement of statements) db.prepare(statement.sql).run(...statement.values)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

const sqlite = await openDb()

describe.skipIf(!sqlite)('one quota per section (SQLite, as D1)', () => {
  const db = sqlite!
  schema(db)
  const draft = (id: string, code: string) => db.prepare(PARTNER_DRAFT_WRITE_SQL).run(code, 'now', 'now', id)

  it('a partner draft cannot take a signup, reserved, mobile or other partner section', () => {
    expect(() => draft('pp-a', '020400001')).toThrow(/section_held/)
    expect(() => draft('pp-a', '020400002')).toThrow(/section_held/)
    expect(() => draft('pp-a', '020400003')).toThrow(/section_held/)
    expect(() => draft('pp-a', '020400004')).toThrow(/section_held/)
    draft('pp-a', '020400010')
    expect(() => draft('pp-b', '020400010')).toThrow(/section_held|UNIQUE/)
  })

  it('a signup cannot draft, publish or insert a partner-held section', () => {
    expect(() => db.prepare(`UPDATE signups SET draft_section = '020400010' WHERE id = 's1'`).run()).toThrow(/reserved_section/)
    expect(() => db.prepare(`UPDATE signups SET published_section = '020400010' WHERE id = 's1'`).run()).toThrow(/reserved_section/)
    expect(() => db.prepare(`INSERT INTO signups (id, email, draft_section) VALUES ('s9', 'x', '020400010')`).run()).toThrow(/reserved_section/)
    // Unrelated signup writes still pass.
    db.prepare(`INSERT INTO signups (id, email, draft_section, published_section) VALUES ('s8', 'y', '', '')`).run()
    db.prepare(`UPDATE signups SET draft_section = '020400020' WHERE id = 's8'`).run()
  })

  it('publishing creates the „И аз“ reservation; unpublishing removes it', async () => {
    const { publishStatements, unpublishStatements } = await import('./partner-sections')
    const fake = d1(db)
    fake.batch(publishStatements(fake as never, { id: 'pp-a', mir: '02', draft: '020400010', published: '' }, 'now') as never)
    const row = db.prepare(`SELECT organisation FROM taken_sections WHERE section_code = '020400010'`).get() as { organisation: string }
    expect(row.organisation).toBe(PARTNER_RESERVATION_ORG)
    expect((db.prepare(`SELECT section_published AS p FROM partner_people WHERE id = 'pp-a'`).get() as { p: string }).p).toBe('020400010')
    // The person's own reservation does not block them; others are blocked by it.
    db.prepare(`UPDATE partner_people SET section_draft = '020400011' WHERE id = 'pp-a'`).run()
    db.prepare(`UPDATE partner_people SET section_draft = '020400010' WHERE id = 'pp-a'`).run()
    expect(() => draft('pp-b', '020400010')).toThrow(/section_held|UNIQUE/)
    const held = db.prepare(PARTNER_BLOCKED_SQL).all() as Array<{ code: string; src: string }>
    expect(blockedCodes(held).has('020400010')).toBe(true)
    fake.batch(unpublishStatements(fake as never, { id: 'pp-a', published: '020400010' }, 'now') as never)
    expect(db.prepare(`SELECT 1 FROM taken_sections WHERE section_code = '020400010'`).get()).toBeUndefined()
    expect((db.prepare(`SELECT section_draft AS d, section_published AS p FROM partner_people WHERE id = 'pp-a'`).get() as { d: string; p: string | null })).toEqual({ d: '020400010', p: null })
  })

  it('publishing onto another organisation’s reservation rolls back', async () => {
    const { publishStatements } = await import('./partner-sections')
    const fake = d1(db)
    db.prepare(`UPDATE partner_people SET section_draft = '020400030' WHERE id = 'pp-b'`).run()
    db.prepare(`INSERT INTO taken_sections (section_code, organisation, created_at) VALUES ('020400030', 'ПП', 'now')`).run()
    expect(() => fake.batch(publishStatements(fake as never, { id: 'pp-b', mir: '02', draft: '020400030', published: '' }, 'now') as never)).toThrow(/section_held/)
    expect((db.prepare(`SELECT section_published AS p FROM partner_people WHERE id = 'pp-b'`).get() as { p: string | null }).p).toBeNull()
    expect((db.prepare(`SELECT organisation FROM taken_sections WHERE section_code = '020400030'`).get() as { organisation: string }).organisation).toBe('ПП')
  })
})

describe('no email, no Brevo for partner sections', () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')
  it.each(['./partner-sections.ts', './partner-sections-admin.ts', '../routes/admin/-partner-sections-panel.tsx'])('%s imports no mail or Brevo module', (file) => {
    const source = read(file)
    expect(source).not.toMatch(/from '\.\/(mail|confirm-mail|assignment-notify|brevo[^']*|admin-brevo|designation-brevo[^']*)'/)
    expect(source).not.toMatch(/^import[^\n]*(brevo|mail|notify)/im)
    expect(source).not.toMatch(/sendMail|sendEmail|EMAIL\.send|api\.brevo\.com/)
  })
  it.each(['mail.ts', 'confirm-mail.ts', 'assignment-notify.ts', 'admin-assign-actions.ts', 'brevo-campaign.ts', 'brevo-sync.ts', 'admin-brevo.ts', 'brevo-contact.ts', 'brevo-sections-export.ts'])(
    '%s never reads partner people',
    (file) => {
      expect(read(`./${file}`)).not.toMatch(/partner_people|partner-sections|PARTNER_SECTION/)
    },
  )
})

describe('„И аз“ with the country ranking', () => {
  const base = { id: 'pp-x', mir: '14', regionCode: '14', municipality: 'Перник', note: '', draft: '', published: '' }

  it('reads the reach: the МИР, the oblast and every МИР named in Общини', () => {
    expect(partnerReachMirs(base)).toEqual(['14'])
    expect(partnerReachMirs({ ...base, mir: '', regionCode: 'sofia-merged', municipality: 'Столична', note: 'неразпознати: Перник, Кюстендил, София-област' })).toEqual([
      '10',
      '14',
      '23',
      '24',
      '25',
      '26',
    ])
    expect(partnerReachMirs({ ...base, mir: '17', regionCode: '17', municipality: 'Карлово', note: 'и: Сопот; коментар: Перник е далеч' })).toEqual(['17'])
  })

  const results = (sections: Array<[string, number]>) => ({
    nodes: [{ id: 55871, type: 'town', nodes: sections.map(([segment, voters]) => ({ name: `адрес ${segment}`, type: 'address', nodes: [{ segment, type: 'section', stats: { voters } }] })) }],
  })

  it('takes the more important section across the reach, a machine one included, and never a held one', async () => {
    const getJson = async (path: string) => {
      if (path === 'results/1432.json') return results([['143200001', 900], ['143200002', 250]])
      if (path.startsWith('towns?') && path.includes('election_region=14') && path.endsWith('municipality=32')) return [{ id: 55871 }]
      if (path === 'sections?town=55871') return ['143200001', '143200002'].map((id) => ({ id, place: `адрес ${id}`, town: { id: 55871 } }))
      if (path === 'results/1029.json') return results([['102900001', 200]])
      return null
    }
    const people = [
      { ...base, id: 'pp-a', note: 'неразпознати: Кюстендил' },
      { ...base, id: 'pp-b' },
      { ...base, id: 'pp-c', draft: '143200009' },
      { ...base, id: 'pp-d' },
    ]
    const planned = await planPartnerDistribution({
      people,
      blocked: new Set(['143200002']),
      priority: new Map([['102900001', { r: 2, level: 'elevated' }]]),
      alsoVolunteer: new Set(['pp-d']),
      getJson,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const byPerson = Object.fromEntries(planned.plan.drafts.map((row) => [row.personId, row.code]))
    // pp-b can only use Перник: planned first (fewest options), takes the machine section (no paper free).
    expect(byPerson['pp-b']).toBe('143200001')
    // pp-a also accepts Кюстендил: gets the priority section there.
    expect(byPerson['pp-a']).toBe('102900001')
    expect(planned.plan.skipped.map((row) => [row.personId, row.reason]).sort()).toEqual([
      ['pp-c', 'has-section'],
      ['pp-d', 'also-volunteer'],
    ])
  })
})

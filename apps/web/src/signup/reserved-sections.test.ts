import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { publishBlocked, scoreSectionSuggestions, validateAssignment, warningSummary } from './admin-assign'
import { orderByPriority, rankWithPriority, summarizePriorityCoverage } from './priority-sections'
import {
  cleanOrg,
  conflictsFor,
  describePlan,
  parseReservedCsv,
  planReservations,
  reservedCode,
  reservedMessage,
  sameOrg,
} from './reserved-sections'
import { RESERVED_SECTION_GUARDS, isReservedAbort } from './reserved-sections-sql'

describe('parseReservedCsv', () => {
  it('reads ; with a Bulgarian header, a BOM, a note and a lost leading zero', () => {
    const parsed = parseReservedCsv('\uFEFFСИК;Организация;Бележка\n40400082;ГЕРБ;от 18.10\n234600101; Друга  орг ;\n')
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toEqual([
      { sectionCode: '040400082', organisation: 'ГЕРБ', note: 'от 18.10', place: '', line: 2 },
      { sectionCode: '234600101', organisation: 'Друга орг', note: '', place: '', line: 3 },
    ])
  })

  it('reads , and English headers in any order, with quotes', () => {
    const parsed = parseReservedCsv('note,organisation,section_code\n"a, b",X,010100001\n')
    expect(parsed.rows).toEqual([{ sectionCode: '010100001', organisation: 'X', note: 'a, b', place: '', line: 2 }])
  })

  it('takes a code-only file without a header and the organisation from the form', () => {
    const parsed = parseReservedCsv('010100001\n010100002\r\n', '  БСП  ')
    expect(parsed.rows.map((row) => [row.sectionCode, row.organisation, row.line])).toEqual([
      ['010100001', 'БСП', 1],
      ['010100002', 'БСП', 2],
    ])
  })

  it('prefers the row organisation over the form one; tab works too', () => {
    expect(parseReservedCsv('010100001\tИТН\n010100002\t\n', 'БСП').rows.map((row) => row.organisation)).toEqual(['ИТН', 'БСП'])
  })

  it('reports invalid codes, rows without an organisation and duplicates', () => {
    const parsed = parseReservedCsv('секция;организация\nabc;X\n12345;X\n010100001;\n010100002;A\n010100002;B\n010100002;A\n')
    expect(parsed.invalid.map((row) => [row.line, row.reason.slice(0, 3)])).toEqual([[2, 'СИК'], [3, 'СИК'], [4, 'Ням']])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({ sectionCode: '010100002', organisation: 'A' })
    expect(parsed.duplicates).toEqual([{ sectionCode: '010100002', lines: [5, 6, 7] }])
  })

  it('refuses a file whose first column is neither a code nor a code header', () => {
    expect(parseReservedCsv('име;имейл\nx;y\n').errors[0]).toMatch(/СИК/)
    expect(parseReservedCsv('').errors[0]).toMatch(/празен/)
  })

  it('normalises codes and organisations', () => {
    expect(reservedCode(' 2346 00101 ')).toBe('234600101')
    expect(reservedCode('40400082')).toBe('040400082')
    expect(reservedCode('23460010A')).toBe('')
    expect(cleanOrg('  Да   България ')).toBe('Да България')
    expect(sameOrg('герб', 'ГЕРБ ')).toBe(true)
    expect(reservedMessage('010100001', 'ГЕРБ')).toBe('Секция 010100001 е резервирана от ГЕРБ. Там не записваме наши хора.')
  })
})

const PEOPLE = [
  { id: 'p1', email: 'p1@example.com', name: 'Пе Едно', draftSection: '', publishedSection: '010100001' },
  { id: 'p2', email: 'p2@example.com', name: 'Пе Две', draftSection: '010100003', publishedSection: '' },
  { id: 'p3', email: 'p3@example.com', name: 'Пе Три', draftSection: '010100009', publishedSection: '010100009' },
]

describe('planReservations', () => {
  const existing = [
    { sectionCode: '010100001', organisation: 'ГЕРБ', note: '' },
    { sectionCode: '010100002', organisation: 'ГЕРБ', note: 'стара' },
    { sectionCode: '010100004', organisation: 'БСП', note: '' },
    { sectionCode: '010100005', organisation: 'ГЕРБ', note: '' },
  ]

  it('merges: new, updated, unchanged, moved; flags unknown codes and our people there', () => {
    const plan = planReservations({
      csv: 'СИК;организация;бележка\n010100001;ГЕРБ;\n010100002;ГЕРБ;нова\n010100003;ГЕРБ;\n010100004;ГЕРБ;\n999999999;ГЕРБ;\n',
      formOrg: '',
      mode: 'merge',
      existing,
      people: PEOPLE,
      isKnown: (code) => code !== '999999999',
    })
    expect(plan.errors).toEqual([])
    expect(plan.add.map((row) => row.sectionCode)).toEqual(['010100003', '999999999'])
    expect(plan.update.map((row) => row.sectionCode)).toEqual(['010100002'])
    expect(plan.unchanged.map((row) => row.sectionCode)).toEqual(['010100001'])
    expect(plan.moved).toEqual([expect.objectContaining({ sectionCode: '010100004', from: 'БСП', organisation: 'ГЕРБ' })])
    expect(plan.remove).toEqual([])
    expect(plan.unknown).toEqual(['999999999'])
    expect(plan.conflicts.map((item) => [item.sectionCode, item.personId, item.kind])).toEqual([
      ['010100001', 'p1', 'published'],
      ['010100003', 'p2', 'draft'],
    ])
    expect(describePlan(plan)).toContain('с наши хора 2')
  })

  it('replaces one organisation: removes its codes missing from the file, leaves the others', () => {
    const plan = planReservations({ csv: '010100001\n', formOrg: 'герб', mode: 'replace', existing, people: PEOPLE, isKnown: () => true })
    expect(plan.errors).toEqual([])
    expect(plan.remove.map((row) => row.sectionCode)).toEqual(['010100002', '010100005'])
    expect(plan.unchanged).toHaveLength(0)
    expect(plan.update.map((row) => row.sectionCode)).toEqual(['010100001'])
  })

  it('replace needs the form organisation and a file for that organisation only', () => {
    expect(planReservations({ csv: '010100001;ГЕРБ\n', formOrg: '', mode: 'replace', existing, people: [], isKnown: () => true }).errors[0]).toMatch(/напиши организацията/)
    expect(planReservations({ csv: '010100001;БСП\n', formOrg: 'ГЕРБ', mode: 'replace', existing, people: [], isKnown: () => true }).errors[0]).toMatch(/само за една организация/)
  })

  it('lists conflicts once per person and kind, published before a different draft', () => {
    const reserved = new Map([['010100001', 'ГЕРБ'], ['010100003', 'БСП'], ['010100009', 'ИТН']])
    expect(conflictsFor(reserved, PEOPLE).map((item) => `${item.sectionCode}:${item.kind}:${item.organisation}`)).toEqual([
      '010100001:published:ГЕРБ',
      '010100003:draft:БСП',
      '010100009:published:ИТН',
    ])
  })
})

describe('enforcement', () => {
  it('blocks a reserved section on publish, with the organisation in the message', () => {
    const warnings = validateAssignment({ section: '010100001', personId: 'a', personMir: '01', takenOrg: 'ГЕРБ', duplicate: null })
    expect(publishBlocked(warnings)).toBe(true)
    expect(warningSummary(warnings)).toBe('Секцията е резервирана от ГЕРБ. Там не записваме наши хора.')
  })

  it('keeps reserved sections out of „Предложи“, including priority ones', () => {
    const blocked = new Set(['010100001'])
    const plain = scoreSectionSuggestions([{ id: '010100001', place: 'А' }, { id: '010100002', place: 'Б' }], { mir: '01', town: '', municipality: '', place: '', radius: '', travelMunicipalities: '' }, blocked, 8)
    expect(plain.map((item) => item.id)).toEqual(['010100002'])
    const priority = [{ sectionCode: '010100001', town: 'Банско', municipality: 'Банско', r: 9, level: 'elevated' }]
    expect(rankWithPriority(plain, priority, { town: 'Банско', municipality: 'Банско', mir: '01' }, blocked).map((item) => item.id)).toEqual(['010100002'])
  })

  it('counts reserved priority sections apart from ours and from open ones', () => {
    const rows = [
      { sectionCode: '010100001', level: 'watch' },
      { sectionCode: '010100002', level: 'watch' },
      { sectionCode: '010100003', level: 'watch' },
    ]
    const summary = summarizePriorityCoverage(rows, new Set(['010100001']), new Set(), new Set(['010100002']))
    expect(summary).toMatchObject({ total: 3, covered: 1, published: 1, taken: 1, uncovered: 1 })
    // An open priority section that is reserved is never offered as reachable.
    const people = [{ draftSection: '', publishedSection: '', town: 'Банско', municipality: 'Банско', mir: '01' }]
    const reach = orderByPriority(people, [{ sectionCode: '010100002', town: 'Банско', municipality: 'Банско', r: 5, level: 'watch', state: 'taken' as const }], { only: true, sort: true })
    expect(reach).toEqual([])
  })

  it('every server path that writes a draft or a published section checks reservations', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const writers = readdirSync(here)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => {
        const text = readFileSync(join(here, name), 'utf8')
        return /SET draft_section = (?!NULL\b)|published_section = draft_section|draft_section = CASE/.test(text)
      })
      .sort()
    expect(writers).toEqual(['abroad-distribute-admin.ts', 'admin-assign-actions.ts', 'admin-distribute.ts', 'admin.ts', 'assignment-notify.ts'])
    for (const name of writers) {
      const text = readFileSync(join(here, name), 'utf8')
      expect(/reservedOrgOf|reservedMap|taken_sections/.test(text), name).toBe(true)
    }
  })
})

type Db = { exec(sql: string): void; prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] } }

async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

const sqlite = await openDb()

describe.skipIf(!sqlite)('database guard (SQLite triggers, as D1)', () => {
  function seed() {
    const db = sqlite!
    db.exec('DROP TABLE IF EXISTS signups; DROP TABLE IF EXISTS taken_sections')
    db.exec('CREATE TABLE signups (id TEXT PRIMARY KEY, draft_section TEXT, published_section TEXT, note TEXT)')
    db.exec('CREATE TABLE taken_sections (section_code TEXT PRIMARY KEY, mir_code TEXT, place TEXT, organisation TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL)')
    db.prepare("INSERT INTO signups (id, draft_section, published_section) VALUES ('conflict', '010100001', '010100001'), ('free', NULL, NULL), ('draftonly', '010100001', '010100007')").run()
    for (const sql of RESERVED_SECTION_GUARDS) db.exec(sql)
    db.prepare("INSERT INTO taken_sections (section_code, organisation, created_at) VALUES ('010100001', 'ГЕРБ', 'now')").run()
    return db
  }

  function aborts(fn: () => unknown) {
    try {
      fn()
      return false
    } catch (error) {
      return isReservedAbort(error)
    }
  }

  it('refuses to draft, publish or insert a reserved code', () => {
    const db = seed()
    expect(aborts(() => db.prepare("UPDATE signups SET draft_section = '010100001' WHERE id = 'free'").run())).toBe(true)
    expect(aborts(() => db.prepare("UPDATE signups SET published_section = '010100001' WHERE id = 'free'").run())).toBe(true)
    expect(aborts(() => db.prepare("UPDATE signups SET published_section = draft_section WHERE id = 'draftonly'").run())).toBe(true)
    expect(aborts(() => db.prepare("INSERT INTO signups (id, draft_section) VALUES ('new', '010100001')").run())).toBe(true)
    expect(aborts(() => db.prepare("UPDATE signups SET draft_section = '010100002' WHERE id = 'free'").run())).toBe(false)
  })

  it('keeps existing conflicts and lets them be cleared, reverted or edited elsewhere', () => {
    const db = seed()
    expect(aborts(() => db.prepare("UPDATE signups SET note = 'x', draft_section = draft_section WHERE id = 'conflict'").run())).toBe(false)
    expect(aborts(() => db.prepare("UPDATE signups SET draft_section = NULLIF(COALESCE(published_section, ''), '') WHERE id = 'conflict'").run())).toBe(false)
    expect(aborts(() => db.prepare("UPDATE signups SET draft_section = '010100002' WHERE id = 'draftonly'").run())).toBe(false)
    expect(aborts(() => db.prepare("UPDATE signups SET draft_section = NULL, published_section = NULL WHERE id = 'conflict'").run())).toBe(false)
  })
})

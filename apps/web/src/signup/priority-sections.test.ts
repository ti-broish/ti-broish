import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSectionSearch } from './admin-search'
import {
  comparePriority,
  coverageState,
  formatR,
  levelRank,
  orderByPriority,
  parsePriorityCsv,
  personPriorityReach,
  priorityCode,
  priorityLevelLabel,
  rankWithPriority,
  sortForAssignment,
  summarizePriorityCoverage,
} from './priority-sections'

const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/priority-sections-2026-10-19.csv'), 'utf8')
const HEADER = 'СИК;Населено място;Община;Област;R;level;T;U;V;L;D;P;M;t;N;A;G;u;type;mode;lat;lon'

describe('parsePriorityCsv', () => {
  it('reads the 19 Oct 2026 file with its BOM', () => {
    expect(fixture.charCodeAt(0)).toBe(0xfeff)
    const parsed = parsePriorityCsv(fixture)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(674)
    const levels = parsed.rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.level]: (acc[row.level] ?? 0) + 1 }), {})
    expect(levels).toEqual({ elevated: 60, quarantine: 6, watch: 608 })
    expect(parsed.rows.every((row) => /^\d{9}$/.test(row.sectionCode) && !row.sectionCode.startsWith('32'))).toBe(true)
    const first = parsed.rows.find((row) => row.sectionCode === '040400082')
    expect(first).toMatchObject({ town: 'с.Вонеща вода', municipality: 'Велико Търново', oblast: 'ВЕЛИКО ТЪРНОВО', r: 5.66, level: 'elevated' })
    expect(first?.components).toMatchObject({ T: '4.8', U: '6', type: 'r', mode: 'p', lat: '42.87565', lon: '25.64035' })
    expect(first?.components.P).toBeUndefined()
  })

  it('sorts by R desc and keeps the blank-R quarantine rows last, with R null', () => {
    const { rows } = parsePriorityCsv(fixture)
    const scored = rows.filter((row) => row.r !== null)
    expect(scored).toHaveLength(668)
    for (let index = 1; index < scored.length; index += 1) expect(scored[index - 1].r!).toBeGreaterThanOrEqual(scored[index].r!)
    const blank = rows.slice(668)
    expect(blank.every((row) => row.r === null && row.level === 'quarantine')).toBe(true)
    expect(blank.map((row) => row.sectionCode)).toContain('020400032')
    expect(formatR(null)).toBe('—')
  })

  it('accepts commas, decimal commas, lost leading zeros and CRLF; rejects bad rows and abroad', () => {
    const text = 'СИК,R,level\r\n40400082,"5,5",Elevated\r\n320100001,3,watch\r\nabc,1,watch\r\n010100001,x,watch\r\n010100002,1,watch\r\n010100002,2,watch\r\n'
    const parsed = parsePriorityCsv(text)
    expect(parsed.rows.map((row) => [row.sectionCode, row.r, row.level])).toEqual([
      ['040400082', 5.5, 'elevated'],
      ['010100002', 2, 'watch'],
    ])
    expect(parsed.rejected).toBe(3)
    expect(parsed.duplicates).toBe(1)
  })

  it('needs СИК and R columns', () => {
    expect(parsePriorityCsv('code;level\n010100001;watch').rows).toEqual([])
    expect(parsePriorityCsv('').errors[0]).toMatch(/празен/)
    expect(parsePriorityCsv(`${HEADER}\n`).rows).toEqual([])
  })
})

describe('levels and formatting', () => {
  it('ranks quarantine before elevated before watch and labels them', () => {
    expect(levelRank('quarantine')).toBeLessThan(levelRank('elevated'))
    expect(levelRank('elevated')).toBeLessThan(levelRank('watch'))
    expect(levelRank('other')).toBeGreaterThan(levelRank('watch'))
    expect(priorityLevelLabel('elevated')).toBe('повишен')
    expect(priorityLevelLabel('custom')).toBe('custom')
    expect(formatR(5.666)).toBe('5.67')
    expect(priorityCode('04 0400 082')).toBe('040400082')
    expect(comparePriority({ r: 1, level: 'watch', sectionCode: 'a' }, { r: 1, level: 'quarantine', sectionCode: 'b' })).toBeGreaterThan(0)
  })
})

describe('coverage', () => {
  const rows = [
    { sectionCode: '010100001', level: 'elevated', r: 5 },
    { sectionCode: '010100002', level: 'watch', r: 2 },
    { sectionCode: '010100003', level: 'watch', r: 4 },
    { sectionCode: '010100004', level: 'quarantine', r: 1 },
  ]
  const published = new Set(['010100001'])
  const drafts = new Set(['010100001', '010100002'])
  const taken = new Set(['010100004'])

  it('counts published, draft, taken and open', () => {
    expect(coverageState('010100001', published, drafts, taken)).toBe('published')
    expect(coverageState('010100002', published, drafts, taken)).toBe('draft')
    expect(coverageState('010100004', published, drafts, taken)).toBe('taken')
    expect(coverageState('010100003', published, drafts, taken)).toBe('open')
    const summary = summarizePriorityCoverage(rows, published, drafts, taken)
    expect(summary).toMatchObject({ total: 4, published: 1, draft: 1, taken: 1, covered: 2, uncovered: 1 })
    expect(summary.byLevel.map((item) => item.level)).toEqual(['quarantine', 'elevated', 'watch'])
    expect(summary.byLevel.find((item) => item.level === 'watch')).toEqual({ level: 'watch', total: 2, covered: 1 })
  })

  it('lists open sections first, each by R desc', () => {
    const states = rows.map((row) => ({ ...row, state: coverageState(row.sectionCode, published, drafts, taken) }))
    expect(sortForAssignment(states).map((row) => row.sectionCode)).toEqual(['010100003', '010100001', '010100002', '010100004'])
  })
})

const PRIORITY = [
  { sectionCode: '040400082', town: 'с.Вонеща вода', municipality: 'Велико Търново', r: 5.66, level: 'elevated' },
  { sectionCode: '040400143', town: 'гр.Велико Търново', municipality: 'Велико Търново', r: 3.28, level: 'watch' },
  { sectionCode: '040400150', town: 'гр.Велико Търново', municipality: 'Велико Търново', r: 4.1, level: 'watch' },
  { sectionCode: '153900020', town: 'гр.Кнежа', municipality: 'Кнежа', r: 4.21, level: 'elevated' },
]

describe('rankWithPriority', () => {
  const person = { town: 'Велико Търново', municipality: 'Велико Търново', mir: '4' }
  const plain = [
    { id: '040400001', place: 'Училище', score: 80, reason: 'свободна', desk: 'paper' as const },
    { id: '040400143', place: 'Читалище', score: 20, reason: 'свободна', desk: 'paper' as const },
  ]

  it('puts town priority sections first by R, then the municipality, then the rest', () => {
    const ranked = rankWithPriority(plain, PRIORITY, person, new Set(), 8)
    expect(ranked.map((item) => item.id)).toEqual(['040400150', '040400143', '040400082', '040400001'])
    expect(ranked[1]).toMatchObject({ place: 'Читалище', desk: 'paper', priority: { r: 3.28, level: 'watch', scope: 'town' } })
    expect(ranked[1].reason).toMatch(/^приоритет наблюдение R 3\.28/)
    expect(ranked[2].priority?.scope).toBe('municipality')
    expect(ranked[3].priority).toBeUndefined()
  })

  it('skips blocked codes, other МИР and other municipalities, and honours the limit', () => {
    const ranked = rankWithPriority(plain, PRIORITY, person, new Set(['040400150']), 2)
    expect(ranked.map((item) => item.id)).toEqual(['040400143', '040400082'])
    expect(rankWithPriority([], PRIORITY, { town: 'Кнежа', municipality: 'Кнежа', mir: '04' }, new Set()).map((item) => item.id)).toEqual([])
    expect(rankWithPriority([], PRIORITY, { town: 'Кнежа', municipality: 'Кнежа', mir: '15' }, new Set()).map((item) => item.id)).toEqual(['153900020'])
  })

  it('keeps the plain order when there is no priority list', () => {
    expect(rankWithPriority(plain, [], person, new Set()).map((item) => item.id)).toEqual(['040400001', '040400143'])
  })
})

describe('personPriorityReach / orderByPriority', () => {
  it('prefers the town over a higher R elsewhere in the municipality', () => {
    const reach = personPriorityReach({ town: 'гр. Велико Търново', municipality: 'Велико Търново', mir: '04' }, PRIORITY)
    expect(reach).toEqual({ inTown: 2, inMunicipality: 1, best: { r: 4.1, level: 'watch', scope: 'town' } })
    expect(personPriorityReach({ town: 'Шумен', municipality: 'Шумен', mir: '30' }, PRIORITY).best).toBeNull()
  })

  it('filters and sorts people by the R of their section or reach', () => {
    const people = [
      { id: 'a', draftSection: '', publishedSection: '', town: 'Шумен', municipality: 'Шумен', mir: '30' },
      { id: 'b', draftSection: '', publishedSection: '', town: 'Кнежа', municipality: 'Кнежа', mir: '15' },
      { id: 'c', draftSection: '040400082', publishedSection: '', town: 'София', municipality: 'Столична', mir: '23' },
      { id: 'd', draftSection: '', publishedSection: '010100001', town: 'Кнежа', municipality: 'Кнежа', mir: '15' },
      { id: 'e', draftSection: '', publishedSection: '', town: 'Кнежа', municipality: 'Кнежа', mir: '15', region: '32' },
    ]
    const rows = PRIORITY.map((row) => ({ ...row, state: 'open' as const }))
    expect(orderByPriority(people, rows, { only: false, sort: false }).map((item) => item.person.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(orderByPriority(people, rows, { only: false, sort: true }).map((item) => item.person.id)).toEqual(['c', 'b', 'a', 'd', 'e'])
    const only = orderByPriority(people, rows, { only: true, sort: true })
    expect(only.map((item) => item.person.id)).toEqual(['c', 'b'])
    expect(only[1].reach).toEqual({ r: 4.21, level: 'elevated', scope: 'town' })
    // A covered section no longer counts as reachable.
    const covered = rows.map((row) => (row.sectionCode === '153900020' ? { ...row, state: 'published' as const } : row))
    expect(orderByPriority(people, covered, { only: true, sort: true }).map((item) => item.person.id)).toEqual(['c'])
  })
})

describe('parseSectionSearch prio', () => {
  it('keeps „Само приоритетни“ only when on', () => {
    expect(parseSectionSearch({ view: 'unassigned', prio: true })).toEqual({ q: '', view: 'unassigned', mir: '', prio: true })
    expect(parseSectionSearch({ prio: '1' }).prio).toBe(true)
    expect(parseSectionSearch({ prio: 'no' })).toEqual({ q: '', view: 'unassigned', mir: '' })
  })
})

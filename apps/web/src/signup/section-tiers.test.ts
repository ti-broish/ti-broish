import { describe, expect, it } from 'vitest'
import { distributeSections, tierOf, type DistributePerson, type DistributeSection } from './distribute'
import { lastTurnout, parseTurnout, sectionTier, VOTED_THRESHOLD, type Turnout } from './section-tiers'

function person(id: string, place = 'ул. Друга 9'): DistributePerson {
  return {
    id,
    email: `${id}@example.com`,
    role: 'section',
    mobileTeam: false,
    radius: 'settlement',
    mir: '23',
    regionCode: '23',
    townId: 68134,
    municipalityCode: '46',
    cityRegionCode: '15',
    extraCityRegionCodes: [],
    distantMirs: [],
    travelStops: [],
    place,
    companions: [],
  }
}

function section(id: string, patch: Partial<DistributeSection> = {}): DistributeSection {
  // Current desk: < 300 voters on today's list is paper, 300+ is machine (sectionDesk).
  return { id, place: `адрес ${id}`, townId: 68134, votersCount: 200, isMachine: false, ...patch }
}

const paper = (id: string) => section(id)
const machine = (id: string) => section(id, { votersCount: 700 })

function order(sections: DistributeSection[], turnout: Map<string, Turnout>, priority = new Map<string, { r: number | null; level: string }>()) {
  const people = sections.map((_, index) => person(`p${String(index).padStart(2, '0')}`))
  const plan = distributeSections({ people, sections, turnout, priority })
  // Solo people in one town are placed one at a time, so the assignment order is the section order.
  return plan.assignments.map((row) => row.sectionId)
}

describe('section tiers', () => {
  it('ranks paper > 50, machine > 50, paper ≤ 50, machine ≤ 50, then sections with no data last in their type', () => {
    expect(VOTED_THRESHOLD).toBe(50)
    expect(sectionTier('paper', { voted: 51, registered: 100 })).toMatchObject({ tier: 1, rank: 0 })
    expect(sectionTier('machine', { voted: 51, registered: 900 })).toMatchObject({ tier: 2, rank: 1 })
    expect(sectionTier('paper', { voted: 50, registered: 100 })).toMatchObject({ tier: 3, rank: 2, weight: 100 })
    expect(sectionTier('unknown', { voted: 10, registered: 80 })).toMatchObject({ tier: 3 })
    expect(sectionTier('paper', null)).toMatchObject({ tier: null, rank: 3 })
    expect(sectionTier('machine', { voted: 0, registered: 400 })).toMatchObject({ tier: 4, rank: 4, weight: 400 })
    expect(sectionTier('machine', undefined)).toMatchObject({ tier: null, rank: 5 })
  })

  it('parses the checked-in CIK data', () => {
    expect(parseTurnout('010100001,406,629;bad;010100002,338,547')).toEqual(
      new Map([
        ['010100001', { voted: 406, registered: 629 }],
        ['010100002', { voted: 338, registered: 547 }],
      ]),
    )
    const all = lastTurnout()
    expect(all.size).toBeGreaterThan(12_000)
    expect(all.get('010100001')).toEqual({ voted: 406, registered: 629 })
  })

  it('drafts paper sections in tier order: > 50 voted, then ≤ 50 by registered desc, then new ones', () => {
    const turnout = new Map<string, Turnout>([
      ['234615001', { voted: 20, registered: 150 }],
      ['234615002', { voted: 120, registered: 300 }],
      ['234615003', { voted: 45, registered: 280 }],
      ['234615004', { voted: 300, registered: 600 }],
    ])
    const sections = ['234615001', '234615002', '234615003', '234615004', '234615005'].map(paper)
    // 004 and 002 (tier 1, more voted first), 003 then 001 (tier 3, registered desc), 005 (no data).
    expect(order(sections, turnout)).toEqual(['234615004', '234615002', '234615003', '234615001', '234615005'])
  })

  it('uses the current desk, not April: a section with 700 on today’s list is machine whatever it was in April', () => {
    const turnout = new Map<string, Turnout>([['234615001', { voted: 120, registered: 280 }]])
    const now = machine('234615001')
    expect(tierOf({ ...now, turnout: turnout.get(now.id) })).toMatchObject({ tier: 2 })
  })

  it('drafts every machine section: machine > 50 voted comes before paper ≤ 50', () => {
    const turnout = new Map<string, Turnout>([
      ['234615001', { voted: 400, registered: 700 }],
      ['234615002', { voted: 30, registered: 200 }],
      ['234615003', { voted: 10, registered: 900 }],
      ['234615004', { voted: 90, registered: 150 }],
    ])
    // t1 004, t2 001, t3 002, t4 003. None is on the priority list.
    expect(order([machine('234615001'), paper('234615002'), machine('234615003'), paper('234615004')], turnout)).toEqual([
      '234615004',
      '234615001',
      '234615002',
      '234615003',
    ])
  })

  it('never drafts a reserved machine section', () => {
    const turnout = new Map<string, Turnout>([['234615001', { voted: 400, registered: 700 }]])
    const plan = distributeSections({ people: [person('a')], sections: [machine('234615001')], turnout, blocked: ['234615001'] })
    expect(plan.assignments).toEqual([])
  })

  it('the tier comes first; a priority-list section leads inside its tier', () => {
    const turnout = new Map<string, Turnout>([
      ['234615001', { voted: 400, registered: 700 }],
      ['234615002', { voted: 30, registered: 200 }],
      ['234615003', { voted: 200, registered: 250 }],
      ['234615004', { voted: 60, registered: 90 }],
    ])
    const priority = new Map([
      ['234615002', { r: 3, level: 'elevated' }],
      ['234615004', { r: 1, level: 'watch' }],
    ])
    expect(order([machine('234615001'), paper('234615002'), paper('234615003'), paper('234615004')], turnout, priority)).toEqual([
      '234615004',
      '234615003',
      '234615001',
      '234615002',
    ])
  })

  it('prefers an address with a tier 1 section for a group', () => {
    const turnout = new Map<string, Turnout>([
      ['234615001', { voted: 10, registered: 100 }],
      ['234615002', { voted: 10, registered: 100 }],
      ['234615003', { voted: 90, registered: 200 }],
      ['234615004', { voted: 80, registered: 200 }],
    ])
    const sections = [
      section('234615001', { place: 'ул. А 1' }),
      section('234615002', { place: 'ул. А 1' }),
      section('234615003', { place: 'ул. Б 2' }),
      section('234615004', { place: 'ул. Б 2' }),
    ]
    const a = { ...person('a'), companions: [{ email: 'b@example.com', inGroup: true, samePlace: true, role: 'section', mobileTeam: false }] }
    const b = { ...person('b'), companions: [{ email: 'a@example.com', inGroup: true, samePlace: true, role: 'section', mobileTeam: false }] }
    const plan = distributeSections({ people: [a, b], sections, turnout })
    expect(plan.assignments.map((row) => row.sectionId).sort()).toEqual(['234615003', '234615004'])
  })
})

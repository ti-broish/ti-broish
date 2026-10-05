import { describe, expect, it } from 'vitest'
import {
  describeDistribution,
  distributeSections,
  readPollingSections,
  readTownIds,
  votersFromResults,
  type DistributePerson,
  type DistributeSection,
} from './distribute'

function person(patch: Partial<DistributePerson> & Pick<DistributePerson, 'id' | 'email'>): DistributePerson {
  return {
    role: 'section',
    mobileTeam: false,
    radius: 'cityRegion',
    mir: '23',
    regionCode: '23',
    townId: 68134,
    municipalityCode: '46',
    cityRegionCode: '15',
    extraCityRegionCodes: [],
    place: 'ул. А 1',
    companions: [],
    ...patch,
  }
}

function section(patch: Partial<DistributeSection> & Pick<DistributeSection, 'id' | 'place'>): DistributeSection {
  return { townId: 68134, votersCount: 120, isMachine: false, ...patch }
}

function companion(email: string, patch: Partial<DistributePerson['companions'][number]> = {}) {
  return { email, inGroup: true, samePlace: true, role: 'section' as const, mobileTeam: false, ...patch }
}

describe('distributeSections', () => {
  const home = [
    section({ id: '234615001', place: 'ул. А 1', votersCount: 180 }),
    section({ id: '234615002', place: 'ул. А 1', votersCount: 220 }),
    section({ id: '234615003', place: 'ул. А 1', votersCount: 640 }),
    section({ id: '234615010', place: 'ул. Б 2', votersCount: 90 }),
  ]

  it('puts a person on a paper section at their address before a machine there', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com' })],
      sections: home,
    })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['234615001'])
    expect(plan.assignments[0]?.desk).toBe('paper')
    expect(plan.skipped).toEqual([])
  })

  it('uses a paper section in the district before a machine at the home address', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', place: 'ул. Машина 1' })],
      sections: [
        section({ id: '234615001', place: 'ул. Машина 1', votersCount: 800 }),
        section({ id: '234615010', place: 'ул. Хартия 2', votersCount: 140 }),
      ],
    })
    expect(plan.assignments[0]?.sectionId).toBe('234615010')
  })

  it('keeps a group on one paper address and leaves machine sections free', () => {
    const plan = distributeSections({
      people: [
        person({ id: 'a', email: 'a@example.com', companions: [companion('b@example.com')] }),
        person({ id: 'b', email: 'b@example.com', companions: [companion('a@example.com')] }),
      ],
      sections: home,
      knownEmails: ['a@example.com', 'b@example.com'],
    })
    expect(plan.assignments.map((row) => row.sectionId).sort()).toEqual(['234615001', '234615002'])
    expect(plan.assignments.every((row) => row.together === 'address')).toBe(true)
    expect(plan.keptAtAddress).toBe(1)
    expect(plan.assignments.some((row) => row.sectionId === '234615003')).toBe(false)
  })

  it('falls back to the same town when no address fits the group', () => {
    const plan = distributeSections({
      people: [
        person({ id: 'a', email: 'a@example.com', radius: 'settlement', companions: [companion('b@example.com')] }),
        person({ id: 'b', email: 'b@example.com', radius: 'settlement', companions: [companion('a@example.com')] }),
      ],
      sections: [
        section({ id: '234615001', place: 'ул. А 1' }),
        section({ id: '234615010', place: 'ул. Б 2' }),
      ],
    })
    expect(plan.assignments.map((row) => row.together)).toEqual(['town', 'town'])
    expect(new Set(plan.assignments.map((row) => row.place)).size).toBe(2)
  })

  it('falls back to the municipality when the towns cannot fit the group', () => {
    const plan = distributeSections({
      people: [
        person({
          id: 'a',
          email: 'a@example.com',
          radius: 'municipality',
          townId: 1,
          place: 'с. А',
          companions: [companion('b@example.com')],
        }),
        person({
          id: 'b',
          email: 'b@example.com',
          radius: 'municipality',
          townId: 2,
          place: 'с. Б',
          companions: [companion('a@example.com')],
        }),
      ],
      sections: [
        section({ id: '234615001', place: 'с. А', townId: 1 }),
        section({ id: '234615101', place: 'с. Б', townId: 2 }),
      ],
    })
    expect(plan.assignments.map((row) => row.together)).toEqual(['municipality', 'municipality'])
  })

  it('stays inside the chosen district, and nearby may use an extra district', () => {
    const sections = [
      section({ id: '234615001', place: 'Младост' }),
      section({ id: '234602001', place: 'Средец' }),
      section({ id: '234603001', place: 'Възраждане' }),
    ]
    const strict = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com' })],
      sections,
    })
    expect(strict.assignments[0]?.sectionId).toBe('234615001')

    const nearby = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', radius: 'nearby', extraCityRegionCodes: ['2'], place: 'Средец' })],
      sections: [section({ id: '234615001', place: 'Младост', votersCount: 900 }), section({ id: '234602001', place: 'Средец', votersCount: 110 })],
    })
    expect(nearby.assignments[0]?.sectionId).toBe('234602001')

    const outside = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', radius: 'nearby', extraCityRegionCodes: ['02'] })],
      sections: [section({ id: '234603001', place: 'Възраждане' })],
    })
    expect(outside.assignments).toEqual([])
    expect(outside.skipped[0]?.reason).toBe('no-section')
  })

  it('leaves mobile people, wide travel, and abroad for later', () => {
    const sections = [section({ id: '234615001', place: 'ул. А 1' })]
    const plan = distributeSections({
      people: [
        person({ id: 'm', email: 'm@example.com', role: 'mobile' }),
        person({ id: 't', email: 't@example.com', mobileTeam: true }),
        person({ id: 'v', email: 'v@example.com', role: 'video' }),
        person({ id: 'r', email: 'r@example.com', radius: 'region' }),
        person({ id: 'd', email: 'd@example.com', radius: 'distant' }),
        person({ id: 'f', email: 'f@example.com', regionCode: '32', mir: '32', radius: 'settlement' }),
        person({ id: 'n', email: 'n@example.com', radius: '', townId: null }),
      ],
      sections,
    })
    expect(plan.assignments).toEqual([])
    expect(plan.skipped.map((row) => row.reason)).toEqual(['mobile', 'mobile', 'mobile', 'wide', 'wide', 'abroad', 'no-place'])
  })

  it('does not reuse a blocked section or cross into another MIR', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', radius: 'settlement' })],
      sections: [
        section({ id: '234615001', place: 'ул. А 1' }),
        section({ id: '244615001', place: 'ул. А 1' }),
      ],
      blocked: ['234615001'],
    })
    expect(plan.assignments).toEqual([])
    expect(plan.skipped[0]?.reason).toBe('no-section')
  })

  it('holds a paper section for a companion who has not signed up', () => {
    const plan = distributeSections({
      people: [
        person({ id: 'a', email: 'a@example.com', companions: [companion('new@example.com')] }),
        person({ id: 'b', email: 'b@example.com', place: 'ул. А 1' }),
      ],
      sections: [
        section({ id: '234615001', place: 'ул. А 1' }),
        section({ id: '234615002', place: 'ул. А 1' }),
        section({ id: '234615010', place: 'ул. Б 2' }),
      ],
      knownEmails: ['a@example.com', 'b@example.com'],
    })
    const assigned = Object.fromEntries(plan.assignments.map((row) => [row.personId, row.sectionId]))
    expect(assigned.a).toBe('234615001')
    expect(assigned.b).toBe('234615010')
    expect(plan.keptAtAddress).toBe(1)
  })

  it('prefers the address where the rest of the group is already drafted', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', companions: [companion('lead@example.com')], place: 'ул. Б 2' })],
      sections: [
        section({ id: '234615001', place: 'ул. А 1' }),
        section({ id: '234615010', place: 'ул. Б 2' }),
        section({ id: '234615011', place: 'ул. Б 2' }),
        section({ id: '234615012', place: 'ул. Б 2' }),
      ],
      blocked: ['234615009'],
      anchors: [{ email: 'lead@example.com', place: 'ул. А 1', townId: 68134, companionEmails: ['a@example.com'] }],
    })
    expect(plan.assignments[0]?.sectionId).toBe('234615001')
  })

  it('picks one paper section ahead of many sections with no voter count', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', place: 'ул. А 1' })],
      sections: [
        section({ id: '234615001', place: 'ул. А 1', votersCount: null }),
        section({ id: '234615002', place: 'ул. А 1', votersCount: null }),
        section({ id: '234615003', place: 'ул. А 1', votersCount: 0 }),
        section({ id: '234615010', place: 'ул. Б 2', votersCount: 140 }),
      ],
    })
    expect(plan.assignments[0]?.sectionId).toBe('234615010')
    expect(plan.assignments[0]?.desk).toBe('paper')
  })

  it('skips a person when every section in range is a machine', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com' })],
      sections: [section({ id: '234615001', place: 'ул. А 1', votersCount: 800 })],
    })
    expect(plan.assignments).toEqual([])
    expect(plan.skipped[0]?.reason).toBe('no-section')
  })

  it('holds a single seat when two people name the same unsigned companion', () => {
    const plan = distributeSections({
      people: [
        person({ id: 'a', email: 'a@example.com', companions: [companion('new@example.com')] }),
        person({ id: 'c', email: 'c@example.com', place: 'ул. Б 2', companions: [companion('new@example.com')] }),
        person({ id: 'b', email: 'b@example.com', place: 'ул. Б 2' }),
      ],
      sections: [
        section({ id: '234615001', place: 'ул. А 1' }),
        section({ id: '234615002', place: 'ул. А 1' }),
        section({ id: '234615010', place: 'ул. Б 2' }),
        section({ id: '234615011', place: 'ул. Б 2' }),
      ],
      knownEmails: ['a@example.com', 'b@example.com', 'c@example.com'],
    })
    const assigned = Object.fromEntries(plan.assignments.map((row) => [row.personId, row.sectionId]))
    expect(assigned.a).toBe('234615001')
    expect(assigned.b).toBe('234615011')
    expect(assigned.c).toBe('234615010')
    expect(plan.skipped).toEqual([])
  })

  it('uses an unknown section only when no paper section is free', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', radius: 'settlement' })],
      sections: [
        section({ id: '234615001', place: 'ул. А 1', votersCount: 0 }),
        section({ id: '234615002', place: 'ул. Б 2', votersCount: null }),
      ],
    })
    expect(plan.assignments[0]?.desk).toBe('unknown')
    expect(plan.assignments[0]?.sectionId).toBe('234615001')
  })
})

describe('distribution sources', () => {
  it('reads voter counts from nested results and ignores empty ones', () => {
    const voters = votersFromResults({
      nodes: [{ nodes: [{ segment: '234615001', stats: { voters: 180 } }, { segment: '234615002', stats: { voters: 0 } }] }],
    })
    expect(voters.get('234615001')).toBe(180)
    expect(voters.has('234615002')).toBe(false)
  })

  it('reads town ids and section rows from the public list', () => {
    expect(readTownIds([{ id: 5, name: 'с. А' }, { id: 'няма' }])).toEqual([5])
    const sections = readPollingSections(
      [{ id: 234615001, place: 'ул. А 1', town: { id: 5 }, voters_count: 40, is_machine: false }],
      9,
    )
    expect(sections).toEqual([{ id: '234615001', place: 'ул. А 1', townId: 5, votersCount: 40, isMachine: false, isMobile: null }])
  })

  it('describes the outcome for the team', () => {
    expect(
      describeDistribution({ drafted: 2, paper: 2, mobile: 3, wide: 1, abroad: 0, noPlace: 0, noSection: 1, keptAtAddress: 1 }),
    ).toBe('Записахме 2 чернови в хартиени секции. За после остават 3 мобилни, 1 с обхват област или по-далеч. Без свободна хартиена секция в обхвата: 1. 1 група е на един адрес.')
    expect(
      describeDistribution({ drafted: 1, paper: 1, mobile: 0, wide: 0, abroad: 0, noPlace: 0, noSection: 0, keptAtAddress: 0 }),
    ).toBe('Записахме 1 чернова в хартиена секция.')
    expect(
      describeDistribution({ drafted: 0, paper: 0, mobile: 0, wide: 0, abroad: 0, noPlace: 0, noSection: 0, keptAtAddress: 0 }),
    ).toBe('Записахме 0 чернови.')
  })
})

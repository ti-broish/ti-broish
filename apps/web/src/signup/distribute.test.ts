import { describe, expect, it, vi } from 'vitest'

// These cases are about reach, groups and holds. Tier order has its own tests (section-tiers.test.ts).
vi.mock('./last-turnout.data', () => ({ LAST_TURNOUT: '', LAST_TURNOUT_SOURCE: 'test' }))
import {
  describeClearedDrafts,
  describeDistribution,
  distributeSections,
  distributionHold,
  heldSectionCodes,
  readPollingSections,
  readResultsSections,
  readTownIds,
  relevantPrefixes,
  votersFromResults,
  wholeReachMirs,
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
    distantMirs: [],
    travelStops: [],
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

  it('leaves only the mobile team, video, and abroad for later', () => {
    const sections = [section({ id: '234615001', place: 'ул. А 1' })]
    const plan = distributeSections({
      people: [
        person({ id: 'm', email: 'm@example.com', role: 'mobile' }),
        person({ id: 't', email: 't@example.com', mobileTeam: true }),
        person({ id: 'v', email: 'v@example.com', role: 'video' }),
        person({ id: 'f', email: 'f@example.com', regionCode: '32', mir: '32', radius: 'settlement' }),
        person({ id: 'n', email: 'n@example.com', radius: '', townId: null }),
      ],
      sections,
    })
    expect(plan.assignments).toEqual([])
    expect(plan.skipped.map((row) => row.reason)).toEqual(['mobile', 'mobile', 'video', 'abroad', 'no-place'])
  })

  it('sends a volunteer who accepts other oblasts to a travel area on a tie, and lets the tier win across the reach', () => {
    const homeFirst = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', radius: 'distant', distantMirs: ['02'], place: 'ул. А 1' })],
      sections: [
        section({ id: '234615001', place: 'ул. А 1', votersCount: null }),
        section({ id: '023700001', place: 'Бургас', townId: 42, votersCount: 120 }),
      ],
    })
    // Same tier (no voter data) and same importance: the travel area wins the tie.
    expect(homeFirst.assignments[0]?.sectionId).toBe('023700001')

    const away = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', radius: 'distant', distantMirs: ['02'], place: 'ул. А 1' })],
      sections: [
        section({ id: '234615001', place: 'ул. А 1', votersCount: 800 }),
        section({ id: '023700001', place: 'Бургас', townId: 42, votersCount: 120 }),
        section({ id: '163700001', place: 'Пловдив', townId: 99, votersCount: 80 }),
      ],
    })
    // A paper section in a travel oblast beats a machine section at home: tier order wins over closeness.
    expect(away.assignments[0]?.sectionId).toBe('023700001')

    const homeTaken = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', radius: 'distant', distantMirs: ['02'], place: 'ул. А 1' })],
      sections: [
        section({ id: '234615001', place: 'ул. А 1', votersCount: 800 }),
        section({ id: '023700001', place: 'Бургас', townId: 42, votersCount: 120 }),
        section({ id: '163700001', place: 'Пловдив', townId: 99, votersCount: 80 }),
      ],
      blocked: ['234615001'],
    })
    expect(homeTaken.assignments[0]?.sectionId).toBe('023700001')
  })

  it('keeps an oblast volunteer in that oblast and prefers their address', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', radius: 'region', mir: '27', regionCode: '27', townId: 18157, place: 'Дом за стари хора' })],
      sections: [
        section({ id: '273700001', place: 'Читалище', townId: 18157, votersCount: null }),
        section({ id: '273700010', place: 'Дом за стари хора, ул. Патриарх Евтимий 5', townId: 18157, votersCount: null }),
        section({ id: '234615001', place: 'Дом за стари хора', townId: 68134, votersCount: 120 }),
      ],
    })
    expect(plan.assignments[0]?.sectionId).toBe('273700010')
    expect(plan.assignments[0]?.desk).toBe('unknown')

    const sofia = distributeSections({
      people: [person({ id: 's', email: 's@example.com', radius: 'region', mir: '23', regionCode: 'sofia-merged', place: 'Младост' })],
      sections: [
        section({ id: '244600001', place: 'Люлин', votersCount: 140 }),
        section({ id: '234615001', place: 'Младост', votersCount: 900 }),
      ],
    })
    expect(sofia.assignments[0]?.sectionId).toBe('244600001')
  })

  it('stays inside the municipalities an oblast volunteer picked', () => {
    const volunteer = person({
      id: 'a',
      email: 'a@example.com',
      radius: 'region',
      mir: '06',
      regionCode: '06',
      townId: 100,
      municipalityCode: '01',
      cityRegionCode: '',
      place: 'Враца',
      travelStops: [{ regionCode: '06', code: '20' }],
    })
    const sections = [
      section({ id: '060100001', place: 'Враца', townId: 100, votersCount: 90 }),
      section({ id: '062000011', place: 'Козлодуй', townId: 200, votersCount: 200 }),
      section({ id: '060100002', place: 'Враца', townId: 100, votersCount: 800 }),
    ]
    const limited = distributeSections({ people: [volunteer], sections })
    expect(limited.assignments[0]?.sectionId).toBe('062000011')

    const wholeOblast = distributeSections({ people: [{ ...volunteer, travelStops: [] }], sections })
    expect(wholeOblast.assignments[0]?.sectionId).toBe('060100001')

    const onlyMachinesThere = distributeSections({
      people: [volunteer],
      sections: [
        section({ id: '060100001', place: 'Враца', townId: 100, votersCount: 90 }),
        section({ id: '062000011', place: 'Козлодуй', townId: 200, votersCount: 800 }),
      ],
    })
    // Outside the picked municipalities stays out; a machine section inside them is drafted.
    expect(onlyMachinesThere.assignments.map((row) => [row.sectionId, row.desk])).toEqual([['062000011', 'machine']])
  })

  it('limits each distant oblast to its picked municipalities and prefers them on a tie', () => {
    const volunteer = person({
      id: 'a',
      email: 'a@example.com',
      radius: 'distant',
      distantMirs: ['06', '02'],
      travelStops: [{ regionCode: '06', code: '20' }],
      place: 'ул. А 1',
    })
    const homeFirst = distributeSections({
      people: [volunteer],
      sections: [
        section({ id: '234615001', place: 'ул. А 1', votersCount: 140 }),
        section({ id: '060100001', place: 'Враца', townId: 100, votersCount: 90 }),
        section({ id: '062000011', place: 'Козлодуй', townId: 200, votersCount: 200 }),
      ],
    })
    // Враца is outside the picked municipality; Козлодуй (named) wins the tie over home.
    expect(homeFirst.assignments[0]?.sectionId).toBe('062000011')

    const away = distributeSections({
      people: [volunteer],
      sections: [
        section({ id: '234615001', place: 'ул. А 1', votersCount: 800 }),
        section({ id: '060100001', place: 'Враца', townId: 100, votersCount: 90 }),
        section({ id: '062000011', place: 'Козлодуй', townId: 200, votersCount: 200 }),
        section({ id: '023700001', place: 'Бургас', townId: 42, votersCount: 120 }),
      ],
      blocked: ['234615001'],
    })
    expect(away.assignments[0]?.sectionId).toBe('023700001')

    const onlyKozloduy = distributeSections({
      people: [{ ...volunteer, distantMirs: ['06'] }],
      sections: [
        section({ id: '234615001', place: 'ул. А 1', votersCount: 800 }),
        section({ id: '060100001', place: 'Враца', townId: 100, votersCount: 90 }),
        section({ id: '062000011', place: 'Козлодуй', townId: 200, votersCount: 200 }),
      ],
      blocked: ['234615001'],
    })
    expect(onlyKozloduy.assignments[0]?.sectionId).toBe('062000011')
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

  it('drafts a machine section when it is the only one in range', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com' })],
      sections: [section({ id: '234615001', place: 'ул. А 1', votersCount: 800 })],
    })
    expect(plan.assignments.map((row) => [row.sectionId, row.desk])).toEqual([['234615001', 'machine']])
  })

  it('still skips a person when every section in range is reserved', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com' })],
      sections: [section({ id: '234615001', place: 'ул. А 1', votersCount: 800 })],
      blocked: ['234615001'],
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

  it('reads a section with no city region from the municipality results', () => {
    const ruse = person({
      id: 'a',
      email: 'a@example.com',
      mir: '19',
      regionCode: '19',
      townId: 63427,
      municipalityCode: '27',
      cityRegionCode: '',
      radius: 'settlement',
      place: 'ул. Петър Берон 20',
    })
    expect(
      relevantPrefixes(
        [ruse],
        [section({ id: '192700011', place: 'ул. Петър Берон 20', townId: 63427, votersCount: null })],
      ),
    ).toEqual(['1927'])
    expect(
      relevantPrefixes([person({ id: 'a', email: 'a@example.com' })], [section({ id: '234615001', place: 'ул. А 1' })]),
    ).toEqual(['234615'])
    const distantHome = person({
      id: 'd',
      email: 'd@example.com',
      radius: 'distant',
      distantMirs: ['06'],
      travelStops: [{ regionCode: '23', code: '01' }],
    })
    expect(relevantPrefixes([distantHome], [section({ id: '234615001', place: 'ул. А 1' })])).toEqual(['234615'])
  })

  it('leaves a section above 300 voters free when a smaller paper section is free', () => {
    const plan = distributeSections({
      people: [
        person({
          id: 'a',
          email: 'a@example.com',
          mir: '19',
          regionCode: '19',
          townId: 63427,
          municipalityCode: '27',
          cityRegionCode: '',
          radius: 'settlement',
          place: 'ул. Петър Берон 20',
        }),
      ],
      sections: [
        section({ id: '192700011', place: 'ул. Петър Берон 20', townId: 63427, votersCount: 734 }),
        section({ id: '192700182', place: 'ул. Дрян 17', townId: 63427, votersCount: 180 }),
      ],
    })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['192700182'])
    expect(plan.assignments[0]?.desk).toBe('paper')
  })

  it('reads town ids and section rows from the public list', () => {
    expect(readTownIds([{ id: 5, name: 'с. А' }, { id: 'няма' }])).toEqual([5])
    const sections = readPollingSections(
      [{ id: 234615001, place: 'ул. А 1', town: { id: 5 }, voters_count: 40, is_machine: false }],
      9,
    )
    expect(sections).toEqual([{ id: '234615001', place: 'ул. А 1', townId: 5, votersCount: 40, isMachine: false, isMobile: null }])
  })

  it('treats a Bulgaria section missing from the preliminary voter list as mobile', () => {
    const sections = readPollingSections(
      [
        { id: '192700011', place: 'ул. Петър Берон 20' },
        { id: '192700211', place: 'гр. Русе' },
        { id: '010300141', place: 'МБАЛ Благоевград' },
      ],
      1,
    )
    expect(sections.map((row) => [row.id, row.isMobile])).toEqual([
      ['192700011', null],
      ['192700211', true],
      ['010300141', true],
    ])
  })

  it('does not assign a mobile or hospital section', () => {
    const plan = distributeSections({
      people: [
        person({
          id: 'a',
          email: 'a@example.com',
          mir: '19',
          regionCode: '19',
          townId: 63427,
          municipalityCode: '27',
          cityRegionCode: '',
          radius: 'settlement',
          place: 'гр. Русе',
        }),
      ],
      sections: [
        section({ id: '192700211', place: 'гр. Русе', townId: 63427, isMobile: true, votersCount: null }),
        section({ id: '192700182', place: 'ул. Дрян 17', townId: 63427, votersCount: 180 }),
      ],
    })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['192700182'])
  })

  it('describes the outcome for the team', () => {
    expect(
      describeDistribution({ drafted: 2, paper: 2, mobile: 3, video: 0, abroad: 0, noPlace: 0, noSection: 1, keptAtAddress: 1 }),
    ).toBe('Записахме 2 чернови в хартиени секции. За после остават 3 мобилни. Без свободна секция в обхвата: 1. 1 група е на един адрес.')
    expect(
      describeDistribution({ drafted: 0, paper: 0, mobile: 1, video: 1, abroad: 0, noPlace: 0, noSection: 0, keptAtAddress: 0 }),
    ).toBe('Записахме 0 чернови. За после остават 1 мобилен, 1 на видеонаблюдение.')
    expect(
      describeDistribution({ drafted: 1, paper: 1, mobile: 0, video: 0, abroad: 0, noPlace: 0, noSection: 0, keptAtAddress: 0 }),
    ).toBe('Записахме 1 чернова в хартиена секция.')
    expect(
      describeDistribution({ drafted: 0, paper: 0, mobile: 0, video: 0, abroad: 0, noPlace: 0, noSection: 0, keptAtAddress: 0 }),
    ).toBe('Записахме 0 чернови.')
    expect(
      describeDistribution({ drafted: 4, paper: 4, mobile: 0, video: 0, abroad: 0, noPlace: 0, noSection: 0, keptAtAddress: 0, kept: 1 }),
    ).toBe('Записахме 4 чернови в хартиени секции. Задържахме 1 корекция.')
    expect(
      describeDistribution({ drafted: 0, paper: 0, mobile: 0, video: 0, abroad: 0, noPlace: 0, noSection: 0, keptAtAddress: 0, kept: 2 }),
    ).toBe('Записахме 0 чернови. Задържахме 2 корекции.')
    expect(describeClearedDrafts(0)).toBe('Няма автоматични чернови за изчистване. Ръчните чернови и публикуваните секции остават.')
    expect(describeClearedDrafts(1)).toBe('Изчистихме 1 автоматична чернова. Ръчните чернови и публикуваните секции остават.')
    expect(describeClearedDrafts(12)).toBe('Изчистихме 12 автоматични чернови. Ръчните чернови и публикуваните секции остават.')
  })

  it('keeps a saved correction and lets the next run reuse an unlocked draft', () => {
    const rows = [
      { draftSection: '234615001', publishedSection: '', locked: false },
      { draftSection: '234615002', publishedSection: '', locked: true },
      { draftSection: '234615003', publishedSection: '234615004', locked: false },
    ]
    expect(rows.map((row) => distributionHold(row))).toEqual(['rewrite', 'correction', 'published'])
    expect(heldSectionCodes(rows).sort()).toEqual(['234615002', '234615003', '234615004'])
    const plan = distributeSections({
      people: [person({ id: 'b', email: 'b@example.com' })],
      sections: [
        section({ id: '234615001', place: 'ул. А 1', votersCount: 100 }),
        section({ id: '234615002', place: 'ул. Б 2', votersCount: 80 }),
      ],
      blocked: heldSectionCodes(rows),
      anchors: [{ email: 'locked@example.com', place: 'ул. Б 2', townId: 68134, companionEmails: [] }],
    })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['234615001'])
    expect(plan.assignments.some((row) => row.sectionId === '234615002')).toBe(false)
  })
})

describe('distributeSections with priority sections', () => {
  const town = [
    section({ id: '234615001', place: 'ул. А 1', votersCount: 120 }),
    section({ id: '234615020', place: 'ул. В 3', votersCount: 150 }),
    section({ id: '234615030', place: 'ул. Г 4', votersCount: 160 }),
  ]

  it('puts a person in a priority section in their town before a paper section at their address', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com' })],
      sections: town,
      priority: new Map([['234615020', { r: 0.4, level: 'watch' }]]),
    })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['234615020'])
  })

  it('takes the higher R first, and a blank R after every scored one', () => {
    const priority = new Map([
      ['234615001', { r: null, level: 'quarantine' }],
      ['234615020', { r: 0.4, level: 'watch' }],
      ['234615030', { r: 0.9, level: 'elevated' }],
    ])
    const plan = distributeSections({
      people: ['a', 'b', 'c'].map((id) => person({ id, email: `${id}@example.com`, place: '' })),
      sections: town,
      priority,
    })
    const byPerson = new Map(plan.assignments.map((row) => [row.personId, row.sectionId]))
    expect(byPerson.get('a')).toBe('234615030')
    expect(byPerson.get('b')).toBe('234615020')
    expect(byPerson.get('c')).toBe('234615001')
  })

  it('for a municipality radius: a priority section anywhere in reach leads its tier, higher R first', () => {
    const sections = [
      section({ id: '010100001', place: 'ул. Дом 1', townId: 1, votersCount: 100 }),
      section({ id: '010100002', place: 'ул. Дом 2', townId: 1, votersCount: 100 }),
      section({ id: '010100101', place: 'Село', townId: 2, votersCount: 80 }),
    ]
    const villager = (id: string) =>
      person({ id, email: `${id}@example.com`, radius: 'municipality', mir: '01', regionCode: '01', municipalityCode: '01', townId: 1, cityRegionCode: '', place: 'ул. Дом 1' })
    const onlyVillage = distributeSections({
      people: [villager('a')],
      sections,
      priority: new Map([['010100101', { r: 0.2, level: 'watch' }]]),
    })
    expect(onlyVillage.assignments[0]?.sectionId).toBe('010100101')
    const both = distributeSections({
      people: [villager('a')],
      sections,
      priority: new Map([
        ['010100101', { r: 0.9, level: 'elevated' }],
        ['010100002', { r: 0.1, level: 'watch' }],
      ]),
    })
    // Importance over comfort: the village's R 0.9 beats R 0.1 in the home town.
    expect(both.assignments[0]?.sectionId).toBe('010100101')
  })

  it('never uses a blocked (reserved or held) priority section', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com' })],
      sections: town,
      blocked: ['234615020'],
      priority: new Map([['234615020', { r: 0.9, level: 'elevated' }]]),
    })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['234615001'])
  })

  it('uses any machine section, priority-list ones first', () => {
    const machines = [
      section({ id: '234615040', place: 'ул. Д 5', votersCount: 900 }),
      section({ id: '234615050', place: 'ул. Е 6', votersCount: 700, isMachine: true }),
    ]
    const ordinary = distributeSections({ people: [person({ id: 'a', email: 'a@example.com' })], sections: machines })
    expect(ordinary.assignments.map((row) => row.desk)).toEqual(['machine'])

    const prioritized = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com' }), person({ id: 'b', email: 'b@example.com' })],
      sections: machines,
      priority: new Map([['234615050', { r: 1.2, level: 'watch' }]]),
    })
    expect(prioritized.assignments.map((row) => [row.sectionId, row.desk])).toEqual([
      ['234615050', 'machine'],
      ['234615040', 'machine'],
    ])
    expect(prioritized.skipped).toEqual([])
  })

  it('does not let a machine priority section jump ahead of a paper section (tier first)', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com' })],
      sections: [...town, section({ id: '234615040', place: 'ул. Д 5', votersCount: 900 })],
      priority: new Map([['234615040', { r: 0.8, level: 'elevated' }]]),
    })
    expect(plan.assignments.map((row) => row.desk)).toEqual(['paper'])
  })

  it('keeps a person with a companion who already has a section at that address over a priority section', () => {
    const plan = distributeSections({
      people: [person({ id: 'a', email: 'a@example.com', place: '', companions: [companion('b@example.com')] })],
      sections: [...town, section({ id: '234615002', place: 'ул. А 1', votersCount: 140 })],
      blocked: ['234615001'],
      anchors: [{ email: 'b@example.com', place: 'ул. А 1', townId: 68134, companionEmails: ['a@example.com'] }],
      knownEmails: ['a@example.com', 'b@example.com'],
      priority: new Map([['234615020', { r: 0.9, level: 'elevated' }]]),
    })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['234615002'])
  })

  it('reaches a named municipality in a MIR that was not ticked (01 → 10)', () => {
    const volunteer = person({
      id: 'a',
      email: 'a@example.com',
      radius: 'distant',
      mir: '01',
      regionCode: '01',
      townId: 100,
      municipalityCode: '01',
      cityRegionCode: '',
      place: 'Благоевград',
      distantMirs: [],
      travelStops: [{ regionCode: '10', code: '27' }],
    })
    const result = distributeSections({
      people: [volunteer],
      sections: [section({ id: '102700001', place: 'Кочериново', townId: 300, votersCount: 200 })],
    })
    expect(result.assignments[0]?.sectionId).toBe('102700001')
  })
})

describe('distributeSections across the whole accepted reach (home and travel oblasts)', () => {
  // A Лозенец (район 09) volunteer in МИР 23 who also accepts София област (26) and Перник (14).
  const traveller = (patch: Partial<DistributePerson> = {}) =>
    person({
      id: 'v',
      email: 'v@example.com',
      radius: 'distant',
      mir: '23',
      regionCode: 'sofia-merged',
      townId: 68134,
      municipalityCode: '46',
      cityRegionCode: '09',
      distantMirs: ['26', '14'],
      place: 'Лозенец',
      ...patch,
    })
  const turnout = new Map([
    ['254620045', { voted: 400, registered: 900 }],
    ['234609001', { voted: 380, registered: 850 }],
    ['143200001', { voted: 300, registered: 575 }],
    ['263900001', { voted: 40, registered: 300 }],
    ['244605063', { voted: 200, registered: 260 }],
  ])
  const vrabnitsaMachine = section({ id: '254620045', place: 'Връбница', votersCount: 900, isMachine: true })
  const pernikPaper = section({ id: '143200001', place: 'Перник', townId: 55871, votersCount: 280 })
  const samokovSmallPaper = section({ id: '263900001', place: 'Самоков', townId: 65231, votersCount: 120 })
  const sofiaPaper = section({ id: '244605063', place: 'Оборище', votersCount: 260 })

  it('gives a paper section (tier 1) in a travel oblast before a raised-priority machine section elsewhere in Sofia', () => {
    const plan = distributeSections({
      people: [traveller()],
      sections: [vrabnitsaMachine, pernikPaper, samokovSmallPaper],
      priority: new Map([['254620045', { r: 5.17, level: 'elevated' }]]),
      turnout,
    })
    expect(plan.assignments.map((row) => [row.sectionId, row.desk])).toEqual([['143200001', 'paper']])
  })

  it('keeps the tier order across the reach: a home machine > 50 beats a travel paper ≤ 50', () => {
    const plan = distributeSections({ people: [traveller()], sections: [vrabnitsaMachine, samokovSmallPaper], turnout })
    expect(plan.assignments[0]?.sectionId).toBe('254620045')
  })

  it('within one tier ranks by importance (voted), and on an exact tie sends a traveller to the travel area', () => {
    // Sofia paper has fewer voted (200) than Перник (300): Перник is more important.
    const byVoted = distributeSections({ people: [traveller()], sections: [pernikPaper, sofiaPaper], turnout })
    expect(byVoted.assignments[0]?.sectionId).toBe('143200001')
    const tie = new Map([...turnout, ['244605063', { voted: 300, registered: 575 }]])
    const onTie = distributeSections({ people: [traveller()], sections: [sofiaPaper, pernikPaper], turnout: tie })
    expect(onTie.assignments[0]?.sectionId).toBe('143200001')
    // A home-only volunteer with the same sections stays home on the tie.
    const homeOnly = distributeSections({ people: [traveller({ distantMirs: [], radius: 'region' })], sections: [sofiaPaper, pernikPaper], turnout: tie })
    expect(homeOnly.assignments[0]?.sectionId).toBe('244605063')
  })

  it('a priority section in the own район does not beat a more important tier elsewhere in reach', () => {
    const lozenetsMachine = section({ id: '234609001', place: 'Лозенец', votersCount: 850, isMachine: true })
    const plan = distributeSections({
      people: [traveller()],
      sections: [lozenetsMachine, pernikPaper],
      priority: new Map([['234609001', { r: 1.1, level: 'watch' }]]),
      turnout,
    })
    expect(plan.assignments[0]?.sectionId).toBe('143200001')
  })

  it('plans the person with the fewest options first so a traveller does not strand a home-only volunteer', () => {
    // The Перник local can only use Перник; the Sofia traveller would otherwise take it (more voted than Sofia paper).
    const local = person({ id: 'z-local', email: 'l@example.com', radius: 'settlement', mir: '14', regionCode: '14', townId: 55871, municipalityCode: '32', cityRegionCode: '', place: 'Перник' })
    const plan = distributeSections({ people: [traveller({ id: 'a-traveller' }), local], sections: [pernikPaper, sofiaPaper], turnout })
    const byPerson = Object.fromEntries(plan.assignments.map((row) => [row.personId, row.sectionId]))
    expect(byPerson['z-local']).toBe('143200001')
    expect(byPerson['a-traveller']).toBe('244605063')
  })

  it('keeps companions together at one travel address and never uses a blocked travel section', () => {
    const plan = distributeSections({
      people: [
        traveller({ id: 'a', email: 'a@example.com', companions: [companion('b@example.com')] }),
        traveller({ id: 'b', email: 'b@example.com', companions: [companion('a@example.com')] }),
      ],
      sections: [
        vrabnitsaMachine,
        section({ id: '254620046', place: 'Връбница', votersCount: 900, isMachine: true }),
        pernikPaper,
        section({ id: '143200002', place: 'Перник', townId: 55871, votersCount: 445 }),
        section({ id: '143200003', place: 'Перник', townId: 55871, votersCount: 200 }),
      ],
      blocked: ['143200001'],
      turnout: new Map([
        ...turnout,
        ['254620046', { voted: 400, registered: 900 }],
        ['143200002', { voted: 250, registered: 445 }],
        ['143200003', { voted: 120, registered: 200 }],
      ]),
    })
    expect(plan.assignments.map((row) => row.sectionId).sort()).toEqual(['143200002', '143200003'])
    expect(new Set(plan.assignments.map((row) => row.together))).toEqual(new Set(['address']))
  })

  it('lists the whole oblasts to load for a distant volunteer', () => {
    expect(wholeReachMirs(traveller()).sort()).toEqual(['14', '23', '24', '25', '26'])
    expect(wholeReachMirs(traveller({ travelStops: [{ regionCode: '26', code: '39' }] })).sort()).toEqual(['14', '23', '24', '25'])
    expect(wholeReachMirs(person({ id: 'x', email: 'x@example.com' }))).toEqual([])
  })

  it('reads sections with town and address from a municipality results file', () => {
    const rows = readResultsSections({
      segment: '1432',
      nodes: [
        {
          id: 55871,
          type: 'town',
          nodes: [{ name: 'ул. Младен Стоянов 1', type: 'address', nodes: [{ segment: '143200001', type: 'section', stats: { voters: 575 } }] }],
        },
      ],
    })
    expect(rows).toEqual([expect.objectContaining({ id: '143200001', townId: 55871, place: 'ул. Младен Стоянов 1', votersCount: 575 })])
  })
})

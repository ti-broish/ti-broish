// A пълномощно is valid only in its МИР: the allocators, the admin guard and the publish confirmation.
import { describe, expect, it, vi } from 'vitest'

vi.mock('./last-turnout.data', () => ({ LAST_TURNOUT: '', LAST_TURNOUT_SOURCE: 'test' }))
vi.mock('cloudflare:workers', () => ({ env: {} }))
vi.mock('@tanstack/react-start/server', () => ({ getCookie: () => '' }))

import { designationLock, distributeSections, wholeReachMirs, type DistributePerson, type DistributeSection } from './distribute'
import { DESIGNATION_MIR_MISMATCH, designationMirMismatch, sectionMirOf } from './designation-mir-guard'
import { publishBlocked, validateAssignment } from './admin-assign'
import { partnerCanTravel, partnerDistributePerson, type PartnerSectionPerson } from './partner-sections'
import { describePublishPreview, publishConfirmLabel } from './publish-preview'
import { inScope } from './partner-publish'

function person(patch: Partial<DistributePerson> & Pick<DistributePerson, 'id'>): DistributePerson {
  return {
    email: `${patch.id}@example.com`,
    role: 'section',
    mobileTeam: false,
    radius: 'region',
    mir: '23',
    regionCode: 'sofia-merged',
    townId: 68134,
    municipalityCode: '46',
    cityRegionCode: '',
    extraCityRegionCodes: [],
    distantMirs: [],
    travelStops: [],
    place: '',
    companions: [],
    ...patch,
  }
}

const sofia: DistributeSection[] = [
  { id: '234600101', place: 'ул. 23', townId: 68134, votersCount: 300, isMachine: false },
  { id: '244600101', place: 'ул. 24', townId: 68134, votersCount: 300, isMachine: false },
  { id: '254600101', place: 'ул. 25', townId: 68134, votersCount: 300, isMachine: false },
]
// МИР 25 is the most important section in reach: an unnumbered person goes there.
const priority = new Map([['254600101', { r: 9, level: 'high' }]])

describe('allocator: numbered people only inside the пълномощно МИР', () => {
  it('an unnumbered person is unchanged: the best section across the whole reach', () => {
    const plan = distributeSections({ people: [person({ id: 'a' })], sections: sofia, priority })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['254600101'])
  })

  it('a numbered person for МИР 24 gets МИР 24 even when МИР 25 ranks higher', () => {
    const plan = distributeSections({ people: [person({ id: 'a', designationMir: '24' })], sections: sofia, priority })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['244600101'])
  })

  it('no free section in the МИР: skipped, never drafted elsewhere', () => {
    const plan = distributeSections({ people: [person({ id: 'a', designationMir: '24' })], sections: sofia, priority, blocked: ['244600101'] })
    expect(plan.assignments).toEqual([])
    expect(plan.skipped).toEqual([{ personId: 'a', email: 'a@example.com', reason: 'no-section' }])
  })

  it('МИР 32 means abroad only: the country allocator leaves them to the abroad allocation', () => {
    const plan = distributeSections({ people: [person({ id: 'a', designationMir: '32' })], sections: sofia })
    expect(plan.skipped.map((row) => row.reason)).toEqual(['abroad'])
    // And someone living abroad but numbered for a МИР in Bulgaria is drafted there, not skipped as abroad.
    const home = distributeSections({
      people: [person({ id: 'b', regionCode: '32', mir: '32', radius: 'settlement', designationMir: '24', designationAnywhere: true })],
      sections: sofia,
    })
    expect(home.assignments.map((row) => row.sectionId)).toEqual(['244600101'])
  })

  it('a МИР outside every stated place: drafted there only when they can travel', () => {
    const kyustendil: DistributeSection[] = [...sofia, { id: '102900001', place: 'Кюстендил', townId: 41112, votersCount: 400, isMachine: false }]
    const stays = distributeSections({ people: [person({ id: 'a', designationMir: '10' })], sections: kyustendil })
    expect(stays.assignments).toEqual([])
    expect(stays.skipped.map((row) => row.reason)).toEqual(['outside-mir'])
    const travels = distributeSections({ people: [person({ id: 'a', designationMir: '10', designationAnywhere: true })], sections: kyustendil })
    expect(travels.assignments.map((row) => row.sectionId)).toEqual(['102900001'])
    expect(wholeReachMirs(person({ id: 'a', designationMir: '10', designationAnywhere: true }))).toEqual(['10'])
  })

  it('wholeReachMirs loads only the пълномощно МИР of a numbered person', () => {
    expect(wholeReachMirs(person({ id: 'a' })).sort()).toEqual(['23', '24', '25'])
    expect(wholeReachMirs(person({ id: 'a', designationMir: '24' }))).toEqual(['24'])
    expect(designationLock({ designationMir: '3' })).toBe('03')
    expect(designationLock({})).toBe('')
  })
})

describe('„И аз“ allocator', () => {
  const base: PartnerSectionPerson = { id: 'pp-x', mir: '24', regionCode: 'sofia-merged', municipality: 'Столична', note: '', draft: '', published: '' }

  it('a numbered partner is locked to the пълномощно МИР; an unnumbered one keeps the whole reach', () => {
    expect(partnerDistributePerson({ ...base, numbered: true })?.designationMir).toBe('24')
    expect(partnerDistributePerson(base)?.designationMir).toBeUndefined()
    const numbered = partnerDistributePerson({ ...base, numbered: true })!
    const plan = distributeSections({ people: [numbered], sections: sofia, priority })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['244600101'])
  })

  it('reads „can travel“ from the note', () => {
    expect(partnerCanTravel('коментар: Мобилна е. Живее до Пирогов')).toBe(true)
    expect(partnerCanTravel('Бих могла да участвам във всяко населено място, сравнително близко до София')).toBe(true)
    expect(partnerCanTravel('Мобилен е НО не иска да пътува много')).toBe(true)
    expect(partnerCanTravel('коментар: р-н Слатина')).toBe(false)
    expect(partnerCanTravel('')).toBe(false)
  })
})

describe('admin guard: „Секция извън МИР на пълномощното“', () => {
  it('flags a numbered person whose section is in another МИР, never an unnumbered one', () => {
    expect(designationMirMismatch({ designationMir: '26', designationNumber: 512, section: '142200004' })).toEqual({ section: '142200004', sectionMir: '14', designationMir: '26' })
    expect(designationMirMismatch({ designationMir: '26', designationNumber: 512, section: '262600020' })).toBeNull()
    expect(designationMirMismatch({ designationMir: '26', designationNumber: null, section: '142200004' })).toBeNull()
    expect(designationMirMismatch({ designationMir: '3', designationNumber: '508', section: '82000010' })).toEqual({ section: '82000010', sectionMir: '08', designationMir: '03' })
    expect(designationMirMismatch({ designationMir: '32', designationNumber: 519, section: '320021010' })).toBeNull()
    expect(sectionMirOf('32 00 21 010')).toBe('32')
  })

  it('blocks publishing a volunteer draft outside the пълномощно МИР', () => {
    const warnings = validateAssignment({
      section: '254620045',
      personId: 'a',
      personMir: '24',
      takenOrg: null,
      duplicate: null,
      designation: { mir: '24', number: 507 },
    })
    expect(warnings.find((row) => row.code === 'designation_mir')?.message).toContain(DESIGNATION_MIR_MISMATCH)
    expect(publishBlocked(warnings)).toBe(true)
    expect(publishBlocked(validateAssignment({ section: '244620045', personId: 'a', personMir: '24', takenOrg: null, duplicate: null, designation: { mir: '24', number: 507 } }))).toBe(false)
  })
})

describe('bulk publish on /admin/sections', () => {
  it('the confirmation says how many volunteers and how many „И аз“', () => {
    expect(describePublishPreview({ volunteers: 12, partners: 51 })).toBe('Ще публикуваме 12 доброволци и 51 от „И аз“ (без имейл, без Brevo).')
    expect(describePublishPreview({ volunteers: 1, partners: 0, mismatched: 2 })).toContain('Спрени: 2 със секция извън МИР на пълномощното.')
    expect(publishConfirmLabel({ volunteers: 3, partners: 4 })).toBe('Да, публикувай 3 доброволци и 4 от „И аз“ (без имейл)')
  })

  it('partner drafts follow the view: the whole country, one МИР or abroad', () => {
    expect(inScope({ id: 'p', draft: '244600101' }, { view: 'all' })).toBe(true)
    expect(inScope({ id: 'p', draft: '244600101' }, { view: 'mir', mir: '24' })).toBe(true)
    expect(inScope({ id: 'p', draft: '244600101' }, { view: 'mir', mir: '25' })).toBe(false)
    expect(inScope({ id: 'p', draft: '320021010' }, { view: 'abroad' })).toBe(true)
    expect(inScope({ id: 'p', draft: '244600101' }, { view: 'all', ids: ['q'] })).toBe(false)
  })
})

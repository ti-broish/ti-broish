import { describe, expect, it } from 'vitest'
import { emptyProfile, nextAssignment, profileView, signupGap, stepsFor, type Companion, type HomePlace } from './model'
import { companionRows, signupColumns } from './record'
import { validateCall, validateProtocol, validateViolation } from './reports-validate'
import { isProtocolDay } from './election'
import { placeSummaries } from './sections'

const home: HomePlace = {
  regionCode: 'sofia-merged',
  regionName: 'София-град',
  municipalityCode: '46',
  municipalityName: 'Столична',
  townId: 68134,
  townName: 'гр. София',
  cityRegionCode: '15',
  cityRegionName: 'Младост',
  sectionPlace: 'ул. Пример 1',
  paperCount: 2,
  machineCount: 1,
}

function person(patch: Partial<Companion>): Companion {
  return {
    id: 'c',
    mode: 'full',
    firstName: 'Мария',
    middleName: 'Иванова',
    lastName: 'Петрова',
    email: 'maria@example.com',
    phone: '0888000000',
    role: 'section',
    mobileTeam: false,
    rounds: { first: true, runoff: true },
    experience: null,
    samePlace: true,
    inGroup: true,
    status: 'pending',
    ...patch,
  }
}

describe('signup flow', () => {
  it('asks for car seats only for a mobile team or travel outside the city', () => {
    expect(stepsFor({ role: 'section', radius: 'cityRegion' })).not.toContain('seats')
    expect(stepsFor({ role: 'section', radius: 'municipality' })).toContain('seats')
    expect(stepsFor({ role: 'mobile', radius: 'cityRegion' })).toContain('seats')
    expect(stepsFor({ role: 'section', radius: 'cityRegion' })).toContain('travel')
    expect(stepsFor({ role: 'section', radius: 'cityRegion' })).toContain('people')
  })

  it('keeps a finished signup out of the assignment until the essential answers are in', () => {
    const draft = emptyProfile()
    expect(signupGap(draft)).toMatch(/име/)
    const ready = {
      ...draft,
      firstName: 'Иван',
      middleName: 'Иванов',
      lastName: 'Иванов',
      email: 'ivan@example.com',
      phone: '0888123456',
      egn: '0041010002',
      role: 'section' as const,
      rounds: { first: true, runoff: false },
      place: home,
      radius: 'cityRegion' as const,
      consent: true,
    }
    expect(signupGap(ready)).toBeNull()
    expect(nextAssignment(ready, new Date('2026-09-27T12:00:00Z'))?.label).toBe('5 октомври')
    expect(nextAssignment({ rounds: { first: false, runoff: true } }, new Date('2026-09-27T12:00:00Z'))?.label).toBe('26 октомври')
  })

  it('stores the district, hides the national number from the payload, and splits the group', () => {
    const profile = {
      ...emptyProfile(),
      email: 'Ivan@Example.com',
      egn: '0041010002',
      referredBy: 'iaz.bg',
      role: 'mobile' as const,
      place: home,
      radius: 'nearby' as const,
      extraCityRegions: [{ code: '09', name: 'Лозенец' }],
      hasCar: true,
      carSeats: 2,
      hasDrone: false,
      coordinator: true,
      companions: [person({ id: 'in', inGroup: true }), person({ id: 'out', firstName: 'Петър', email: 'peter@example.com', inGroup: false })],
    }
    const columns = signupColumns(profile)
    expect(columns.email).toBe('ivan@example.com')
    expect(columns.source).toBe('iaz.bg')
    expect(columns.referredBy).toBeNull()
    expect(columns.egn).toBe('0041010002')
    expect(JSON.parse(columns.payload).egn).toBe('')
    expect(JSON.parse(signupColumns({ ...profile, assignedSection: '234600101' }).payload).assignedSection).toBeUndefined()
    const assigned = { ...profile, egn: '0041010002', consent: true, assignedSection: '234600101' }
    expect(profileView(assigned)).toBe('assigned')
    expect(profileView({ ...assigned, demoState: 'waiting' } as typeof assigned & { demoState: string })).toBe('assigned')
    expect(JSON.parse(signupColumns({ ...assigned, demoState: 'waiting' } as typeof assigned & { demoState: string }).payload).demoState).toBeUndefined()
    expect(columns.mirCode).toBe('23')
    expect(columns.sectionPlace).toBe('ул. Пример 1')
    expect(columns.carSeats).toBe(2)
    expect(JSON.parse(columns.extraCityRegions)).toEqual([{ code: '09', name: 'Лозенец' }])
    expect(companionRows(profile.companions).map((row) => [row.email, row.inGroup])).toEqual([
      ['maria@example.com', 1],
      ['peter@example.com', 0],
    ])
  })
})

describe('protocol day', () => {
  it('is only the two election dates in Sofia', () => {
    expect(isProtocolDay(new Date('2026-10-25T09:00:00Z'))).toBe(true)
    expect(isProtocolDay(new Date('2026-11-01T09:00:00Z'))).toBe(true)
    expect(isProtocolDay(new Date('2026-10-24T09:00:00Z'))).toBe(false)
    expect(isProtocolDay(new Date('2026-09-27T09:00:00Z'))).toBe(false)
  })
})

describe('section addresses and reports', () => {
  it('counts paper and machine sections that share one address', () => {
    const summaries = placeSummaries([
      { id: '234615001', place: 'ул.Пример 1', votersCount: 100, isMachine: false },
      { id: '234615002', place: 'ул. Пример 1', votersCount: 400, isMachine: false },
      { id: '234615003', place: 'бул. България 1', votersCount: null, isMachine: true },
    ])
    expect(summaries).toEqual([
      expect.objectContaining({ place: 'ул. Пример 1', paper: 1, machine: 1 }),
      expect.objectContaining({ place: 'бул. България 1', paper: 0, machine: 1 }),
    ])
  })

  it('accepts a signal with a place and rejects a short description or a thin protocol', () => {
    const place = { ...home }
    expect(validateViolation({ name: 'Иван', email: 'ivan@example.com', phone: '0888123456', description: 'кратко', place, wantCall: false, photos: [] })).toMatch(/20/)
    const accepted = validateViolation({
      name: 'Иван Иванов',
      email: 'ivan@example.com',
      phone: '0888123456',
      description: 'Председателят не записа забележката в протокола.',
      place,
      wantCall: true,
      photos: [],
    })
    expect(typeof accepted).not.toBe('string')
    expect(validateProtocol({ email: '', note: '', photos: [] })).toMatch(/4/)
    expect(validateCall({ name: 'Иван', phone: '0888', email: '', message: '' })).toMatch(/телефон/)
    const jpeg = { contentType: 'image/jpeg', data: `/9j/${'A'.repeat(40)}` }
    const protocol = validateProtocol({ email: 'ivan@example.com', note: 'Протокол', photos: [jpeg, jpeg, jpeg, jpeg] })
    expect(typeof protocol).not.toBe('string')
  })
})

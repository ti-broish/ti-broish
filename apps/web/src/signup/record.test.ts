import { describe, expect, it } from 'vitest'
import { emptyProfile } from './model'
import { companionRows, signupColumns, storedProfile } from './record'

describe('signup columns', () => {
  it('keeps a partner slug out of the personal referral and out of the JSON payload', () => {
    const columns = signupColumns({
      ...emptyProfile(),
      email: 'Ivan@Example.com',
      egn: '0041010002',
      source: null,
      referredBy: 'iaz.bg',
      role: 'section',
      place: {
        regionCode: 'sofia-merged',
        regionName: 'София-град',
        municipalityName: 'Столична',
        townName: 'гр. София',
        cityRegionCode: '15',
        cityRegionName: 'Младост',
        sectionPlace: 'ул. Пример 1',
        paperCount: 2,
        machineCount: 1,
      },
      radius: 'nearby',
      extraCityRegions: [{ code: '09', name: 'Лозенец' }],
      coordinator: true,
      companions: [
        {
          ...emptyProfile().companions[0],
          id: 'c1',
          firstName: 'Мария',
          middleName: 'Иванова',
          lastName: 'Иванова',
          email: 'maria@example.com',
          phone: '0888000000',
          role: 'section',
          mobileTeam: false,
          rounds: { first: true, runoff: true },
          experience: null,
          samePlace: true,
          inGroup: false,
          status: 'pending',
          mode: 'full',
        },
      ],
    })
    expect(columns.email).toBe('ivan@example.com')
    expect(columns.source).toBe('iaz.bg')
    expect(columns.referredBy).toBeNull()
    expect(columns.egn).toBe('0041010002')
    expect(columns.mirCode).toBe('23')
    expect(columns.sectionPlace).toBe('ул. Пример 1')
    expect(JSON.parse(columns.payload).egn).toBe('')
    expect(JSON.parse(columns.extraCityRegions)).toEqual([{ code: '09', name: 'Лозенец' }])
    expect(storedProfile({ ...emptyProfile(), referredBy: 'Ab3kLm' }).referredBy).toBe('Ab3kLm')
    const people = companionRows([
      {
        id: 'c1',
        mode: 'full',
        firstName: 'Мария',
        middleName: 'Иванова',
        lastName: 'Иванова',
        email: 'Maria@Example.com',
        phone: '0888000000',
        role: 'section',
        mobileTeam: false,
        rounds: { first: true, runoff: true },
        experience: null,
        samePlace: true,
        inGroup: false,
        status: 'pending',
      },
    ])
    expect(people[0]).toMatchObject({ inGroup: 0, email: 'maria@example.com' })
  })
})

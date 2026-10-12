import { describe, expect, it } from 'vitest'
import { emptyProfile, scopeForRadius, toggleDistantCodes } from './model'
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

  it('drops municipalities and districts that the chosen distance does not use', () => {
    const place = {
      regionCode: 'sofia-merged',
      regionName: 'София-град',
      municipalityName: 'Столична',
      townName: 'гр. София',
      cityRegionCode: '15',
      cityRegionName: 'Младост',
    }
    const kozloduy = { regionCode: '06', regionName: 'Враца', code: '20', name: 'Козлодуй' }
    const lozenets = { code: '09', name: 'Лозенец' }
    const town = signupColumns({
      ...emptyProfile(),
      place,
      radius: 'settlement',
      extraCityRegions: [lozenets],
      distantRegionCodes: ['06', '26'],
      travelMunicipalities: [kozloduy],
    })
    expect(JSON.parse(town.extraCityRegions)).toEqual([])
    expect(JSON.parse(town.distantRegionCodes)).toEqual([])
    expect(JSON.parse(town.travelMunicipalities)).toEqual([])
    expect(JSON.parse(town.payload).travelMunicipalities).toEqual([])

    const nearby = signupColumns({
      ...emptyProfile(),
      place,
      radius: 'nearby',
      extraCityRegions: [lozenets],
      travelMunicipalities: [kozloduy],
    })
    expect(JSON.parse(nearby.extraCityRegions)).toEqual([lozenets])
    expect(JSON.parse(nearby.travelMunicipalities)).toEqual([])

    const region = scopeForRadius('region', { regionCode: '06', regionName: 'Враца' }, {
      extraCityRegions: [lozenets],
      distantRegionCodes: ['02'],
      travelMunicipalities: [kozloduy, { regionCode: '02', regionName: 'Бургас', code: '00', name: 'Бургас' }],
    })
    expect(region.travelMunicipalities).toEqual([kozloduy])
    expect(region.distantRegionCodes).toEqual([])
    expect(region.extraCityRegions).toEqual([])

    const removed = toggleDistantCodes(['06', '02'], [kozloduy, { regionCode: '02', regionName: 'Бургас', code: '00', name: 'Бургас' }], '06')
    expect(removed.distantRegionCodes).toEqual(['02'])
    expect(removed.travelMunicipalities.map((stop) => stop.name)).toEqual(['Бургас'])
  })
})

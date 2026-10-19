import { describe, expect, it } from 'vitest'
import { distributeAbroad, scoreAbroadSuggestions, type AbroadDistributePerson, type AbroadDistributeSection } from './abroad-distribute'

function person(patch: Partial<AbroadDistributePerson> & Pick<AbroadDistributePerson, 'id' | 'email'>): AbroadDistributePerson {
  return {
    role: 'section',
    mobileTeam: false,
    regionCode: '32',
    mir: '32',
    countryName: 'Австрия',
    cityName: 'Виена',
    ...patch,
  }
}

function section(patch: Partial<AbroadDistributeSection> & Pick<AbroadDistributeSection, 'id' | 'city' | 'tierLetter'>): AbroadDistributeSection {
  return {
    country: 'Австрия',
    placeLabel: patch.city,
    capacity: 1,
    ...patch,
  }
}

const vienna = [
  section({ id: '320021002', city: 'Виена', placeLabel: 'Виена (Културен център)', tierLetter: 'B' }),
  section({ id: '320021001', city: 'Виена', placeLabel: 'Виена (Посолство)', tierLetter: 'A' }),
  section({ id: '320020015', city: 'Клагенфурт', tierLetter: 'C' }),
]

const bremen = [
  section({ id: '320271056', country: 'Германия ФР', city: 'Бремен', placeLabel: 'Бремен 1', tierLetter: 'C' }),
  section({ id: '320271057', country: 'Германия ФР', city: 'Бремен', placeLabel: 'Бремен 2', tierLetter: 'B', capacity: 1 }),
]

describe('distributeAbroad', () => {
  it('prefers lower tier rank then section id among matching free seats', () => {
    const plan = distributeAbroad({
      people: [person({ id: 'a', email: 'a@example.com', cityName: 'Vienna' })],
      sections: vienna,
    })
    expect(plan.assignments).toEqual([
      {
        personId: 'a',
        email: 'a@example.com',
        sectionId: '320021002',
        country: 'Австрия',
        city: 'Виена',
        tierLetter: 'B',
      },
    ])
    expect(plan.unmatched).toEqual([])
    expect(plan.counts.assigned).toBe(1)
    expect(plan.counts.byTier.B).toBe(1)
  })

  it('matches Германия to Германия ФР and fills C before B', () => {
    const plan = distributeAbroad({
      people: [
        person({ id: '1', email: '1@example.com', countryName: 'Германия', cityName: 'Бремен' }),
        person({ id: '2', email: '2@example.com', countryName: 'Германия', cityName: 'Bremen' }),
      ],
      sections: bremen,
    })
    expect(plan.assignments.map((row) => row.sectionId)).toEqual(['320271056', '320271057'])
    expect(plan.assignments.map((row) => row.tierLetter)).toEqual(['C', 'B'])
  })

  it('skips domestic, mobile, video, and empty city', () => {
    const plan = distributeAbroad({
      people: [
        person({ id: 'dom', email: 'dom@example.com', regionCode: '23', mir: '23' }),
        person({ id: 'mob', email: 'mob@example.com', mobileTeam: true }),
        person({ id: 'vid', email: 'vid@example.com', role: 'video' }),
        person({ id: 'city', email: 'city@example.com', cityName: '' }),
      ],
      sections: vienna,
    })
    expect(plan.assignments).toEqual([])
    expect(plan.unmatched.map((row) => row.reason)).toEqual(['not_abroad', 'mobile', 'video', 'no_city'])
  })

  it('reports city_not_found vs no_capacity', () => {
    const missing = distributeAbroad({
      people: [person({ id: 'a', email: 'a@example.com', cityName: 'Грац' })],
      sections: vienna,
    })
    expect(missing.unmatched[0]?.reason).toBe('city_not_found')

    const full = distributeAbroad({
      people: [
        person({ id: 'a', email: 'a@example.com' }),
        person({ id: 'b', email: 'b@example.com' }),
        person({ id: 'c', email: 'c@example.com' }),
      ],
      sections: [
        section({ id: '320021001', city: 'Виена', tierLetter: 'A', capacity: 1 }),
        section({ id: '320021002', city: 'Виена', tierLetter: 'B', capacity: 1 }),
      ],
    })
    expect(full.assignments).toHaveLength(2)
    expect(full.unmatched).toEqual([{ personId: 'c', email: 'c@example.com', reason: 'no_capacity', detail: 'Австрия / Виена' }])
  })

  it('respects blocked section codes', () => {
    const plan = distributeAbroad({
      people: [person({ id: 'a', email: 'a@example.com' })],
      sections: vienna,
      blocked: ['320021002'],
    })
    expect(plan.assignments[0]?.sectionId).toBe('320021001')
  })
})

describe('scoreAbroadSuggestions', () => {
  it('ranks city and lower tier higher', () => {
    const scored = scoreAbroadSuggestions(
      [...vienna, ...bremen],
      { countryName: 'Австрия', cityName: 'Виена' },
      new Set(['320021001']),
      5,
    )
    expect(scored.every((row) => row.country === 'Австрия')).toBe(true)
    expect(scored[0]?.id).toBe('320021002')
    expect(scored.some((row) => row.id === '320021001')).toBe(false)
  })
})

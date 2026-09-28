import { describe, expect, it } from 'vitest'
import { emptyProfile, type Companion } from '../signup/model'
import { profileFacts } from './ProfileSummary'

function companion(patch: Partial<Companion>): Companion {
  return {
    id: 'c',
    mode: 'full',
    firstName: 'Мария',
    middleName: '',
    lastName: 'Петрова',
    email: 'maria@example.com',
    phone: '0888000001',
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

describe('profile facts', () => {
  it('lists the answers and never the national number', () => {
    const facts = Object.fromEntries(
      profileFacts({
        ...emptyProfile(),
        firstName: 'Иван',
        middleName: 'Иванов',
        lastName: 'Иванов',
        email: 'ivan@example.com',
        phone: '0888123456',
        egn: '0041010002',
        role: 'mobile',
        rounds: { first: true, runoff: false },
        experience: 'counted',
        place: {
          regionCode: 'sofia-merged',
          regionName: 'София-град',
          municipalityName: 'Столична',
          townName: 'гр. София',
          cityRegionName: 'Младост',
        },
        radius: 'nearby',
        extraCityRegions: [{ code: '09', name: 'Лозенец' }],
        hasCar: true,
        carSeats: 2,
        hasDrone: false,
        companions: [companion({}), companion({ id: 'out', firstName: 'Петър', lastName: 'Георгиев', inGroup: false })],
      }).map((fact) => [fact.label, fact.value]),
    )
    expect(facts['Име']).toBe('Иван Иванов Иванов')
    expect(facts['Роля']).toBe('Мобилен екип')
    expect(facts['Дни']).toBe('25 октомври')
    expect(facts['Място']).toContain('Младост')
    expect(facts['Пътуване']).toContain('Лозенец')
    expect(facts['Пътуване']).toContain('кола, 2 места')
    expect(facts['Пътуване']).toContain('без дрон')
    expect(facts['Опит']).toBe('Броил си 1–2 пъти')
    expect(facts['Група']).toBe('Мария Петрова · като координатор: Петър Георгиев')
    expect(facts['ЕГН']).toBe('Въведено')
    expect(JSON.stringify(facts)).not.toContain('0041010002')
  })

  it('marks a blank national number as missing', () => {
    const facts = Object.fromEntries(profileFacts(emptyProfile()).map((fact) => [fact.label, fact.value]))
    expect(facts['ЕГН']).toBe('Липсва')
    expect(facts['Група']).toBe('Без група')
    expect(facts['Роля']).toBe('Още не е избрана')
  })
})

import { describe, expect, it } from 'vitest'
import { personReachFrom, publishBlocked, travelLabelOf, validateAssignment, warningSummary, type PersonReach } from './admin-assign'

describe('validateAssignment', () => {
  it('blocks taken and duplicate; a MIR outside the stated places only warns', () => {
    const warnings = validateAssignment({
      section: '234600101',
      personId: 'a',
      personMir: '25',
      takenOrg: 'Друга орг',
      duplicate: { id: 'b', email: 'other@example.com', kind: 'draft' },
    })
    expect(warnings.map((item) => item.code)).toEqual(['taken', 'duplicate', 'mir_mismatch'])
    expect(warnings.map((item) => item.level)).toEqual(['block', 'block', 'warn'])
    expect(publishBlocked(warnings)).toBe(true)
    expect(warningSummary(warnings)).toContain('Друга орг')
    expect(warningSummary(warnings)).toContain('other@example.com')
    expect(warningSummary(warnings)).toContain('МИР')
  })

  it('accepts a free section in the same MIR', () => {
    expect(
      validateAssignment({
        section: '234600101',
        personId: 'a',
        personMir: '23',
        takenOrg: null,
        duplicate: null,
      }),
    ).toEqual([])
  })

  it('ignores empty drafts', () => {
    expect(
      validateAssignment({
        section: '  ',
        personId: 'a',
        personMir: '23',
        takenOrg: 'X',
        duplicate: { id: 'b', email: 'x@y.z', kind: 'published' },
      }),
    ).toEqual([])
  })
})

describe('travelLabelOf', () => {
  it('labels the first travel stops', () => {
    expect(travelLabelOf('[{"name":"Младост"},{"name":"Люлин"},{"name":"Овча купел"},{"name":"Излишък"}]', 'region')).toBe('Младост, Люлин, Овча купел')
    expect(travelLabelOf('[{"name":"Козлодуй"}]', 'municipality')).toBe('')
    expect(travelLabelOf('не е json', 'distant')).toBe('')
  })
})

describe('MIR check respects the places the person accepts', () => {
  // The real case: home MIR 01, „мога да пътувам“ to МИР 10, named Дупница (48) and Кочериново (27).
  const travels: PersonReach = personReachFrom({
    mir: '01',
    region: '01',
    radius: 'distant',
    distant_region_codes: '["10"]',
    travel_municipalities: JSON.stringify([
      { regionCode: '10', regionName: 'Кюстендил', code: '48', name: 'Дупница' },
      { regionCode: '10', regionName: 'Кюстендил', code: '27', name: 'Кочериново' },
    ]),
  })
  const check = (section: string, reach: PersonReach) =>
    validateAssignment({ section, personId: 'a', personMir: reach.mir, reach, takenOrg: null, duplicate: null })

  it('does not warn for a МИР 10 section in a municipality they named (01 → 10)', () => {
    expect(check('102700001', travels)).toEqual([])
    expect(check('104800012', travels)).toEqual([])
    expect(check('010100001', travels)).toEqual([])
  })

  it('warns, never blocks, for a МИР 10 municipality they did not name', () => {
    const warnings = check('102200003', travels)
    expect(warnings.map((item) => [item.code, item.level])).toEqual([['outside_places', 'warn']])
    expect(warningSummary(warnings)).toContain('Дупница')
    expect(publishBlocked(warnings)).toBe(false)
  })

  it('warns, never blocks, for a MIR they did not pick', () => {
    const warnings = check('162200155', travels)
    expect(warnings.map((item) => [item.code, item.level])).toEqual([['mir_mismatch', 'warn']])
    expect(publishBlocked(warnings)).toBe(false)
  })

  it('counts a ticked MIR without named municipalities as the whole MIR', () => {
    expect(check('102200003', { ...travels, travelStops: [] })).toEqual([])
  })

  it('counts the whole of София for „в областта“', () => {
    const sofia = personReachFrom({ mir: '23', region: 'sofia-merged', radius: 'region' })
    expect(check('254611067', sofia)).toEqual([])
    expect(check('244607077', sofia)).toEqual([])
    expect(check('162200155', sofia)[0]?.level).toBe('warn')
  })
})


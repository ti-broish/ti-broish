import { describe, expect, it } from 'vitest'
import { publishBlocked, reachFromColumns, scoreSectionSuggestions, travelLabelOf, validateAssignment, warningSummary } from './admin-assign'

describe('validateAssignment', () => {
  it('blocks taken and duplicate, and only notes a different MIR', () => {
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

  it('never blocks an admin pick in another MIR (01 -> 10), only notes it', () => {
    const warnings = validateAssignment({ section: '100100001', personId: 'a', personMir: '01', takenOrg: null, duplicate: null })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ code: 'mir_mismatch', level: 'warn' })
    expect(warnings[0].message).not.toContain('МИР на секцията е 10, а човекът е в МИР 01.')
    expect(publishBlocked(warnings)).toBe(false)
  })

  it('has no MIR note when the section is in a place the person chose', () => {
    const base = { section: '100100001', personId: 'a', personMir: '01', takenOrg: null, duplicate: null }
    expect(validateAssignment({ ...base, reach: { regionCode: '01', distantRegionCodes: ['10'] } })).toEqual([])
    expect(validateAssignment({ ...base, reach: { regionCode: '01', travelStops: [{ regionCode: '10', code: '01' }] } })).toEqual([])
    expect(validateAssignment({ ...base, reach: reachFromColumns({ regionCode: '01', distantRegionCodes: '["10"]', travelMunicipalities: '[]' }) })).toEqual([])
    expect(validateAssignment({ ...base, reach: reachFromColumns({ regionCode: '01', distantRegionCodes: '[]', travelMunicipalities: '[{"regionCode":"10","regionName":"Кюстендил","code":"01","name":"Бобов дол"}]' }) })).toEqual([])
    // Home oblast: Sofia is 23, 24 and 25; a person in 25 placed in 23 gets no note.
    expect(validateAssignment({ section: '234600101', personId: 'a', personMir: '25', takenOrg: null, duplicate: null, reach: { regionCode: 'sofia-merged' } })).toEqual([])
    // Another MIR they did not pick: still only a note.
    const other = validateAssignment({ ...base, reach: { regionCode: '01', distantRegionCodes: ['11'] } })
    expect(other.map((item) => item.level)).toEqual(['warn'])
    expect(validateAssignment({ ...base, reach: reachFromColumns({ regionCode: '01', distantRegionCodes: 'not json', travelMunicipalities: '' }) }).map((item) => item.level)).toEqual(['warn'])
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

describe('scoreSectionSuggestions', () => {
  it('ranks free same-MIR sections and skips taken or wrong MIR', () => {
    const suggestions = scoreSectionSuggestions(
      [
        { id: '254600001', place: 'училище в друга МИР' },
        { id: '234600101', place: 'ул. Пример 1, гр. София', votersCount: 120 },
        { id: '234600199', place: 'друго място' },
        { id: '234600150', place: 'ул. Пример 1', isMachine: true },
      ],
      {
        mir: '23',
        town: 'гр. София',
        municipality: 'Столична',
        place: 'ул. Пример 1',
        radius: 'settlement',
        travelMunicipalities: '[]',
      },
      new Set(['234600199']),
      5,
    )
    expect(suggestions.map((item) => item.id)).toEqual(['234600101', '234600150'])
    expect(suggestions[0]?.reason).toContain('място')
    expect(suggestions[0]?.reason).toContain('хартиена')
    expect(suggestions[0]?.desk).toBe('paper')
    expect(suggestions[1]?.desk).toBe('machine')
    expect(suggestions.every((item) => item.id.startsWith('23'))).toBe(true)
  })

  it('labels the first travel stops', () => {
    expect(travelLabelOf('[{"name":"Младост"},{"name":"Люлин"},{"name":"Овча купел"},{"name":"Излишък"}]', 'region')).toBe('Младост, Люлин, Овча купел')
    expect(travelLabelOf('[{"name":"Козлодуй"}]', 'municipality')).toBe('')
    expect(travelLabelOf('не е json', 'distant')).toBe('')
  })
})

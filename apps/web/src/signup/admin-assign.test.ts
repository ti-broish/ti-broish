import { describe, expect, it } from 'vitest'
import { publishBlocked, scoreSectionSuggestions, travelLabelOf, validateAssignment, warningSummary } from './admin-assign'

describe('validateAssignment', () => {
  it('warns and blocks taken, duplicate, and MIR mismatch', () => {
    const warnings = validateAssignment({
      section: '234600101',
      personId: 'a',
      personMir: '25',
      takenOrg: 'Друга орг',
      duplicate: { id: 'b', email: 'other@example.com', kind: 'draft' },
    })
    expect(warnings.map((item) => item.code)).toEqual(['taken', 'duplicate', 'mir_mismatch'])
    expect(warnings.every((item) => item.level === 'block')).toBe(true)
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
    expect(travelLabelOf('[{"name":"Младост"},{"name":"Люлин"},{"name":"Овча купел"},{"name":"Излишък"}]')).toBe('Младост, Люлин, Овча купел')
    expect(travelLabelOf('не е json')).toBe('')
  })
})

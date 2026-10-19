import { describe, expect, it } from 'vitest'
import { nextDesignationNumber, parseStoredNumber, planDesignationNumbering } from './designation-number'

describe('designation numbering', () => {
  it('assigns the next integer after the current maximum and keeps stored numbers', () => {
    expect(nextDesignationNumber([])).toBe(1)
    expect(nextDesignationNumber([null, undefined, 0])).toBe(1)
    expect(nextDesignationNumber([2, 5, 3])).toBe(6)
    expect(parseStoredNumber(12)).toBe(12)
    expect(parseStoredNumber('ИК-7')).toBe(7)
    expect(parseStoredNumber('')).toBe(null)
    expect(parseStoredNumber('0')).toBe(null)
  })

  it('numbers unpublished-empty rows in published_section, created_at, id order and never renumbers', () => {
    const plan = planDesignationNumbering(
      [
        { id: 'c', publishedSection: '234600102', createdAt: '2026-01-01', number: null, issuedAt: null },
        { id: 'a', publishedSection: '234600101', createdAt: '2026-02-01', number: null, issuedAt: null },
        { id: 'b', publishedSection: '234600101', createdAt: '2026-01-01', number: 4, issuedAt: '01.10.2026' },
        { id: 'd', publishedSection: '234600101', createdAt: '2026-01-01', number: null, issuedAt: null },
      ],
      4,
      '19.10.2026',
    )
    expect(plan.assigned).toBe(3)
    expect(plan.updates.map((row) => `${row.id}:${row.number}`)).toEqual(['d:5', 'a:6', 'c:7'])
    expect(plan.updates.every((row) => row.issuedAt === '19.10.2026')).toBe(true)
    const again = planDesignationNumbering(
      [
        { id: 'b', publishedSection: '234600101', createdAt: '2026-01-01', number: 4, issuedAt: '01.10.2026' },
        { id: 'd', publishedSection: '234600101', createdAt: '2026-01-01', number: 5, issuedAt: '19.10.2026' },
      ],
      7,
      '19.10.2026',
    )
    expect(again.updates).toEqual([])
  })
})

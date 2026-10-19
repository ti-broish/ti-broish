import { describe, expect, it } from 'vitest'
import {
  DESIGNATION_ASSIGN_SQL,
  DESIGNATION_NUMBER_START,
  designationMirOf,
  formatNumberWithDate,
  maxPerMirFromRows,
  nextDesignationNumber,
  parseStoredNumber,
  planDesignationNumbering,
} from './designation-number'

describe('designation numbering', () => {
  it('starts every МИР at 501 and continues after the stored maximum', () => {
    expect(DESIGNATION_NUMBER_START).toBe(501)
    expect(nextDesignationNumber([])).toBe(501)
    expect(nextDesignationNumber([null, undefined, 0])).toBe(501)
    expect(nextDesignationNumber([501, 505, 503])).toBe(506)
    expect(parseStoredNumber(12)).toBe(12)
    expect(parseStoredNumber('ИК-7')).toBe(7)
    expect(parseStoredNumber('')).toBe(null)
    expect(parseStoredNumber('0')).toBe(null)
    expect(designationMirOf('234600001')).toBe('23')
    expect(designationMirOf('')).toBe('')
  })

  it('formats the number with its date as 501/19.10.2026', () => {
    expect(formatNumberWithDate(501, '19.10.2026')).toBe('501/19.10.2026')
    expect(formatNumberWithDate(' 502 ', ' 01.11.2026 ')).toBe('502/01.11.2026')
  })

  it('keeps independent consecutive sequences per МИР', () => {
    const plan = planDesignationNumbering(
      [
        { id: 'a', publishedSection: '234600101', createdAt: '2026-01-02', number: null, issuedAt: null },
        { id: 'b', publishedSection: '010100001', createdAt: '2026-01-01', number: null, issuedAt: null },
        { id: 'c', publishedSection: '234600101', createdAt: '2026-01-01', number: null, issuedAt: null },
        { id: 'd', publishedSection: '246100001', createdAt: '2026-01-01', number: null, issuedAt: null },
        { id: 'e', publishedSection: '010200001', createdAt: '2026-01-01', number: null, issuedAt: null },
      ],
      new Map(),
      '19.10.2026',
    )
    expect(plan.updates.map((row) => `${row.mir}:${row.id}:${row.number}`)).toEqual([
      '01:b:501',
      '01:e:502',
      '23:c:501',
      '23:a:502',
      '24:d:501',
    ])
    expect(plan.updates.every((row) => row.issuedAt === '19.10.2026')).toBe(true)
  })

  it('continues each МИР after its stored maximum and never renumbers or redates', () => {
    const plan = planDesignationNumbering(
      [
        { id: 'c', publishedSection: '234600102', createdAt: '2026-01-01', number: null, issuedAt: null },
        { id: 'a', publishedSection: '234600101', createdAt: '2026-02-01', number: null, issuedAt: null },
        { id: 'b', publishedSection: '234600101', createdAt: '2026-01-01', number: 504, issuedAt: '01.10.2026', mir: '23' },
        { id: 'd', publishedSection: '234600101', createdAt: '2026-01-01', number: null, issuedAt: null },
        { id: 'x', publishedSection: '030100001', createdAt: '2026-01-01', number: null, issuedAt: null },
      ],
      { '23': 504, '03': 510 },
      '19.10.2026',
    )
    expect(plan.assigned).toBe(4)
    expect(plan.updates.map((row) => `${row.id}:${row.number}`)).toEqual(['x:511', 'd:505', 'a:506', 'c:507'])
    const again = planDesignationNumbering(
      [
        { id: 'b', publishedSection: '234600101', createdAt: '2026-01-01', number: 504, issuedAt: '01.10.2026', mir: '23' },
        { id: 'd', publishedSection: '234600101', createdAt: '2026-01-01', number: 505, issuedAt: '19.10.2026', mir: '23' },
      ],
      { '23': 505 },
      '20.10.2026',
    )
    expect(again.updates).toEqual([])
  })

  it('assigns in one guarded statement per person and reads stored maxima per МИР', () => {
    expect(DESIGNATION_ASSIGN_SQL).toContain('WHERE designation_mir = ?1')
    expect(DESIGNATION_ASSIGN_SQL).toContain('500), 500) + 1')
    expect(DESIGNATION_ASSIGN_SQL).toContain('designation_number IS NULL')
    expect(maxPerMirFromRows([{ mir: '23', n: 503 }, { mir: '', n: 9 }, { mir: '01', n: null }])).toEqual(new Map([['23', 503]]))
  })
})

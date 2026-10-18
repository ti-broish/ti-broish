import { describe, expect, it } from 'vitest'
import { nextDesignationNumber, parseStoredNumber } from './designation-number'

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
})

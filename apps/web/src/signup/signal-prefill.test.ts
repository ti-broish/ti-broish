import { describe, expect, it } from 'vitest'
import { mergePlace, oblastPlace, parseSignalSearch } from './signal-prefill'

describe('parseSignalSearch', () => {
  it('keeps name, email and oblast, trimmed', () => {
    expect(parseSignalSearch({ name: '  Мария   Петрова ', email: ' maria@example.com ', oblast: 'София' })).toEqual({
      name: 'Мария Петрова',
      email: 'maria@example.com',
      oblast: 'София',
    })
  })

  it('reads a numeric oblast that the router parsed as a number', () => {
    expect(parseSignalSearch({ oblast: 23 })).toEqual({ oblast: '23' })
  })

  it('drops empty, oversized, non-string and unknown values', () => {
    expect(parseSignalSearch({ name: '', email: ['a@b.bg'], oblast: { x: 1 }, phone: '0888', other: 'x' })).toEqual({})
    expect(parseSignalSearch({ name: 'а'.repeat(201), email: `${'a'.repeat(250)}@b.bg`, oblast: Number.NaN })).toEqual({})
  })
})

describe('oblastPlace', () => {
  it('maps election region codes, padded or not', () => {
    expect(oblastPlace('01')).toEqual({ regionCode: '01', regionName: 'Благоевград' })
    expect(oblastPlace('3')).toEqual({ regionCode: '03', regionName: 'Варна' })
    expect(oblastPlace('26')).toEqual({ regionCode: '26', regionName: 'София област' })
  })

  it('maps София-град MIRs 23, 24 and 25 to the merged select option', () => {
    for (const code of ['23', '24', '25', 'sofia-merged']) {
      expect(oblastPlace(code)).toEqual({ regionCode: 'sofia-merged', regionName: 'София-град' })
    }
  })

  it('maps abroad', () => {
    expect(oblastPlace('32')).toEqual({ regionCode: '32', regionName: 'Извън страната' })
    expect(oblastPlace('Извън страната')?.regionCode).toBe('32')
  })

  it('maps Bulgarian and Latin names', () => {
    expect(oblastPlace('София')?.regionCode).toBe('sofia-merged')
    expect(oblastPlace('София-град')?.regionCode).toBe('sofia-merged')
    expect(oblastPlace('Sofia')?.regionCode).toBe('sofia-merged')
    expect(oblastPlace('Софийска')?.regionCode).toBe('26')
    expect(oblastPlace('област Варна')?.regionCode).toBe('03')
    expect(oblastPlace('велико търново')?.regionCode).toBe('04')
    expect(oblastPlace('Plovdiv')?.regionCode).toBe('17')
    expect(oblastPlace('Пловдив град')?.regionCode).toBe('16')
  })

  it('ignores unknown values', () => {
    for (const value of [undefined, '', '0', '33', '99', '123', 'Атлантида', '<script>', 'sofia-merged2']) {
      expect(oblastPlace(value)).toBeNull()
    }
  })
})

describe('mergePlace', () => {
  const varna = { regionCode: '03', regionName: 'Варна' }
  const varnaTown = { ...varna, municipalityCode: '06', municipalityName: 'Варна', townId: 10135, townName: 'гр. Варна' }
  const sofia = { regionCode: 'sofia-merged', regionName: 'София-град' }

  it('keeps the profile place when it is in the linked oblast', () => {
    expect(mergePlace(varna, varnaTown)).toEqual(varnaTown)
  })

  it('uses the linked oblast when the profile is elsewhere or empty', () => {
    expect(mergePlace(varna, { ...sofia, municipalityCode: '46' })).toEqual(varna)
    expect(mergePlace(varna, null)).toEqual(varna)
  })

  it('falls back to the profile without a linked oblast', () => {
    expect(mergePlace(null, varnaTown)).toEqual(varnaTown)
    expect(mergePlace(null, null)).toBeNull()
  })
})

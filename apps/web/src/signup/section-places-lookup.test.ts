import { describe, expect, it } from 'vitest'
import { sectionLookupBatches } from './section-places-lookup'

describe('sectionLookupBatches', () => {
  it('keeps codes from the same municipality together and caps pairs at 40', () => {
    const codes: string[] = []
    for (let mir = 1; mir <= 45; mir += 1) {
      const pair = String(mir).padStart(2, '0')
      codes.push(`${pair}0100001`)
      codes.push(`${pair}0100002`)
    }
    const batches = sectionLookupBatches(codes)
    expect(batches).toHaveLength(2)
    expect(batches[0]?.codes).toHaveLength(80)
    expect(batches[1]?.codes).toHaveLength(10)
    const firstPairs = new Set(batches[0]?.codes.map((code) => `${code.slice(0, 2)}:${code.slice(2, 4)}`))
    const secondPairs = new Set(batches[1]?.codes.map((code) => `${code.slice(0, 2)}:${code.slice(2, 4)}`))
    expect(firstPairs.size).toBe(40)
    expect(secondPairs.size).toBe(5)
  })

  it('attaches only town ids for codes in the batch, at most 40', () => {
    const codes = ['230100001', '240200001', '250300001']
    const townIdsByCode: Record<string, number[]> = {
      '230100001': [10, 11],
      '240200001': [20],
      '250300001': [30],
      '999999999': [99],
    }
    const batches = sectionLookupBatches(codes, townIdsByCode)
    expect(batches).toEqual([{ codes: ['230100001', '240200001', '250300001'], townIds: [10, 11, 20, 30] }])

    const many: Record<string, number[]> = {}
    const wide: string[] = []
    for (let i = 1; i <= 45; i += 1) {
      const code = `${String(i).padStart(2, '0')}0100001`
      wide.push(code)
      many[code] = [1000 + i]
    }
    const capped = sectionLookupBatches(wide, many)
    expect(capped[0]?.townIds).toHaveLength(40)
    expect(capped[0]?.townIds).toEqual(Array.from({ length: 40 }, (_, index) => 1001 + index))
    expect(capped[1]?.townIds).toEqual([1041, 1042, 1043, 1044, 1045])
  })
})

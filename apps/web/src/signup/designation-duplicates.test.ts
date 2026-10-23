import { describe, expect, it } from 'vitest'
import { duplicateBadge, duplicateOf, keepersByEgn, planEgnGuard, type EgnHolder } from './designation-duplicates'
import { numberingMessage } from './designation-number-message'

const holder = (over: Partial<EgnHolder>): EgnHolder => ({ id: 'x', kind: 'signup', egnKey: 'e', mir: '03', number: 501, published: true, ...over })

describe('ЕГН guard for numbering', () => {
  it('skips an ЕГН that already holds a number in the other table (volunteer ↔ „И аз“)', () => {
    const holders = [holder({ id: 'vol', egnKey: 'E1', number: 504 }), holder({ id: 'pp-x', kind: 'partner', egnKey: 'E2', mir: '17', number: 506, published: false })]
    const plan = planEgnGuard(
      [
        { id: 'pp-new', kind: 'partner', egnKey: 'E1' },
        { id: 'vol-new', kind: 'signup', egnKey: 'E2' },
        { id: 'free', kind: 'signup', egnKey: 'E3' },
      ],
      holders,
    )
    expect([...plan.allowed]).toEqual(['free'])
    expect(plan.skipped).toEqual([
      { id: 'vol-new', reason: 'duplicate', keeper: { number: 506, mir: '17', keeperId: 'pp-x' } },
      { id: 'pp-new', reason: 'duplicate', keeper: { number: 504, mir: '03', keeperId: 'vol' } },
    ])
  })

  it('in one run the volunteer comes first, whatever the list order', () => {
    const plan = planEgnGuard(
      [
        { id: 'pp-1', kind: 'partner', egnKey: 'E1' },
        { id: 'vol-1', kind: 'signup', egnKey: 'E1' },
        { id: 'vol-2', kind: 'signup', egnKey: 'E1' },
      ],
      [],
    )
    expect([...plan.allowed]).toEqual(['vol-1'])
    expect(plan.skipped.map((row) => [row.id, row.reason, row.keeper?.keeperId])).toEqual([
      ['vol-2', 'duplicate', 'vol-1'],
      ['pp-1', 'duplicate', 'vol-1'],
    ])
  })

  it('never numbers a withdrawn or covered partner row; rows without ЕГН are not deduped', () => {
    const plan = planEgnGuard(
      [
        { id: 'pp-w', kind: 'partner', egnKey: 'E1', withdrawn: true },
        { id: 'pp-c', kind: 'partner', egnKey: 'E2', covered: true },
        { id: 'a', kind: 'signup', egnKey: '' },
        { id: 'b', kind: 'signup', egnKey: '' },
      ],
      [],
    )
    expect([...plan.allowed].sort()).toEqual(['a', 'b'])
    expect(plan.skipped.map((row) => [row.id, row.reason])).toEqual([
      ['pp-w', 'withdrawn'],
      ['pp-c', 'covered'],
    ])
  })
})

describe('duplicate marks', () => {
  it('keeps the volunteer with a section, then any volunteer, then the lower partner number', () => {
    const keepers = keepersByEgn([
      holder({ id: 'pp-5b5', kind: 'partner', egnKey: 'A', number: 515, published: false }),
      holder({ id: 'd24be9', egnKey: 'A', number: 504 }),
      holder({ id: 'pp-2', kind: 'partner', egnKey: 'B', mir: '04', number: 504, published: false }),
      holder({ id: 'pp-1', kind: 'partner', egnKey: 'B', mir: '04', number: 503, published: false }),
      holder({ id: 's-unpub', egnKey: 'C', number: 501, published: false }),
      holder({ id: 's-pub', egnKey: 'C', number: 509, published: true }),
    ])
    expect(keepers.get('A')!.id).toBe('d24be9')
    expect(keepers.get('B')!.id).toBe('pp-1')
    expect(keepers.get('C')!.id).toBe('s-pub')
    expect(duplicateOf({ id: 'pp-5b5', egnKey: 'A' }, keepers)).toEqual({ number: 504, mir: '03', keeperId: 'd24be9' })
    expect(duplicateOf({ id: 'd24be9', egnKey: 'A' }, keepers)).toBeNull()
    // Not numbered yet, ЕГН held elsewhere: also a duplicate (the badge shows the holder's number).
    expect(duplicateOf({ id: 'new', egnKey: 'B' }, keepers)).toEqual({ number: 503, mir: '04', keeperId: 'pp-1' })
    expect(duplicateOf({ id: 'free', egnKey: '' }, keepers)).toBeNull()
    expect(duplicateBadge({ number: 504, mir: '03', keeperId: 'x' })).toBe('Дубликат: същото ЕГН има № 504')
  })
})

describe('numbering message', () => {
  it('says how many were skipped as ЕГН duplicates', () => {
    expect(numberingMessage(3, 2, 0)).toBe('Номерирани 3 души; пропуснати 2 (дубликат по ЕГН).')
    expect(numberingMessage(0, 1, 1)).toBe('Няма нови за номериране; пропуснати 1 (дубликат по ЕГН), пропуснати 1 (покрит от доброволец).')
    expect(numberingMessage(0, 0, 0)).toBe('Всички вече имат номер.')
    expect(numberingMessage(4, 0, 0)).toBe('Номерирани 4 души.')
  })
})

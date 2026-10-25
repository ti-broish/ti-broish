import { describe, expect, it } from 'vitest'
import { describedSignal, placeLine } from './place-line'

describe('placeLine', () => {
  it('names the address and the district', () => {
    expect(placeLine({ sectionPlace: '31 СУЧЕМ, ул. Example 1', cityRegionName: 'Средец' })).toBe('Адрес: 31 СУЧЕМ, ул. Example 1, район Средец')
  })

  it('names whichever one was picked', () => {
    expect(placeLine({ sectionPlace: 'Читалище' })).toBe('Адрес: Читалище')
    expect(placeLine({ cityRegionName: 'Младост' })).toBe('Район: Младост')
  })

  it('is empty without an address or a district', () => {
    expect(placeLine({})).toBe('')
    expect(placeLine(null)).toBe('')
    expect(placeLine({ sectionPlace: ' ', cityRegionName: '' })).toBe('')
  })
})

describe('describedSignal', () => {
  it('puts the place on the first line', () => {
    expect(describedSignal({ cityRegionName: 'Младост' }, 'Председателят не записа забележката.')).toBe('Район: Младост\n\nПредседателят не записа забележката.')
  })

  it('leaves the description alone without a place', () => {
    expect(describedSignal({}, 'Председателят не записа забележката.')).toBe('Председателят не записа забележката.')
  })
})

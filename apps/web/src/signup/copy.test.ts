import { describe, expect, it } from 'vitest'
import { inPlace, signupScope, volunteerNotice } from './copy'
import { radiusOptions, roleLabel, roleTitle, type HomePlace } from './model'

describe('inPlace (в / във)', () => {
  it('uses „във“ before в and ф, „в“ otherwise', () => {
    expect(inPlace('Витоша')).toBe('във Витоша')
    expect(inPlace('Франция', true)).toBe('Във Франция')
    expect(inPlace('гр. Враца')).toBe('в гр. Враца')
    expect(inPlace('Младост')).toBe('в Младост')
    expect(inPlace('София', true)).toBe('В София')
    expect(inPlace('варна')).toBe('във варна')
  })

  it('builds the travel options with the rule', () => {
    const vitosha: HomePlace = { regionCode: 'sofia-merged', regionName: 'София-град', municipalityName: 'Столична', townName: 'гр. София', cityRegionCode: '01', cityRegionName: 'Витоша' }
    expect(radiusOptions(vitosha).map((item) => item.label)).toContain('Само във Витоша')
    const mladost: HomePlace = { ...vitosha, cityRegionName: 'Младост' }
    expect(radiusOptions(mladost).map((item) => item.label)).toContain('Само в Младост')
  })
})

describe('signup copy', () => {
  it('speaks to the volunteer with „ти“', () => {
    expect(volunteerNotice).toContain('Ще бъдеш представител на Инициативния комитет')
    expect(volunteerNotice).not.toContain('бъдете')
    expect(volunteerNotice).toContain('доброволна дейност без заплащане')
  })

  it('names the runoff alone once the first round is over', () => {
    expect(signupScope(true, '25 октомври', '1 ноември')).toBe('Записването е за балотажа на президентските избори на 1 ноември 2026 г.')
    expect(signupScope(false, '25 октомври', '1 ноември')).toContain('25 октомври и 1 ноември')
  })

  it('shows the full role name on review and profile, the short one in lists', () => {
    expect(roleTitle('section')).toBe('Секция с гласуване на хартия')
    expect(roleTitle('mobile')).toBe('Мобилен екип')
    expect(roleTitle('section', true)).toBe('Мобилен екип')
    expect(roleTitle(null)).toBe('Още не е избрана')
    expect(roleLabel('section', false)).toBe('Секция')
  })
})

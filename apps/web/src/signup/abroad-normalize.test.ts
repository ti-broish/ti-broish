import { describe, expect, it } from 'vitest'
import { COUNTRY_ALIASES, foldName, namesMatch, resolveCountryName } from './abroad-normalize'

const API_NAMES = [
  'Германия ФР',
  'Австрия',
  'Саудитска Арабия',
  'Йордания',
  'Република Южна Африка',
  'Обединено кралство Великобритания и Северна Ирландия',
  'Турция',
] as const

describe('foldName', () => {
  it('trims, lowercases, strips prefixes and diacritics', () => {
    expect(foldName('  Гр. София  ')).toBe(foldName('софия'))
    expect(foldName('с. Брест')).toBe(foldName('Брест'))
    expect(foldName('остров Крит')).toBe(foldName('Крит'))
    expect(foldName('Düsseldorf')).toBe('dusseldorf')
  })

  it('matches Latin and Cyrillic city spellings', () => {
    expect(foldName('London')).toBe(foldName('Лондон'))
    expect(foldName('Istanbul')).toBe(foldName('Истанбул'))
    expect(foldName('Vienna')).toBe(foldName('Виена'))
  })
})

describe('namesMatch', () => {
  it('equals after fold and allows contains when length ≥ 3', () => {
    expect(namesMatch('Виена', 'Vienna')).toBe(true)
    expect(namesMatch('Бремен', 'Бремен 1')).toBe(true)
    expect(namesMatch('Германия', 'Германия ФР')).toBe(true)
    expect(namesMatch('ab', 'abc')).toBe(false)
    expect(namesMatch('Париж', 'Берлин')).toBe(false)
  })
})

describe('resolveCountryName', () => {
  it('resolves exact, alias, and fold matches', () => {
    expect(resolveCountryName('Австрия', API_NAMES)).toBe('Австрия')
    expect(resolveCountryName('Германия', API_NAMES)).toBe('Германия ФР')
    expect(resolveCountryName('РЮА', API_NAMES)).toBe('Република Южна Африка')
    expect(resolveCountryName('Кралство Саудитска Арабия', API_NAMES)).toBe('Саудитска Арабия')
    expect(resolveCountryName('Хашемитско кралство Йордания', API_NAMES)).toBe('Йордания')
    expect(resolveCountryName('Turkey', API_NAMES)).toBeNull()
    expect(resolveCountryName('Турция', API_NAMES)).toBe('Турция')
    expect(resolveCountryName('', API_NAMES)).toBeNull()
  })

  it('documents the РЮА alias target', () => {
    expect(COUNTRY_ALIASES.РЮА).toBe('Република Южна Африка')
  })
})

import { describe, expect, it } from 'vitest'
import { cleanName, editDistance, isAnnulledName, maskedEgnMatches, nameKey, normalizeDate, parseDecisionNumber, parseNumberWithDate } from './normalize'

describe('parseNumberWithDate: every shape seen on the РИК registers', () => {
  const cases: Array<[string, number | null, string | null, string?]> = [
    ['501/14.04.2026', 501, '14.04.2026'],
    ['501/14.04.2026 г.', 501, '14.04.2026'],
    ['№1001/16.04.2026г.', 1001, '16.04.2026'],
    ['№ 12 / 07.04.2026', 12, '07.04.2026'],
    ['№ 123/ 07.04.2026', 123, '07.04.2026'],
    ['№9 - 07.04.2026 г.', 9, '07.04.2026'],
    ['1234 от 06.11.2021 г.', 1234, '06.11.2021'],
    ['501/ 14.04.2026', 501, '14.04.2026'],
    ['501 / 14.04.2026', 501, '14.04.2026'],
    ['501/14.04.21', 501, '14.04.2021'],
    ['5/9.11.2021', 5, '09.11.2021'],
    ['12/ 10.11.2021Г.', 12, '10.11.2021'],
    ['501/14.04.2026 г,', 501, '14.04.2026'],
    ['Рз-12/16.04.2026 год.', 12, '16.04.2026', 'Рз'],
    ['Кт-3/16.04.2026 год.', 3, '16.04.2026', 'Кт'],
    ['РЗ-12/ 16.04.2026', 12, '16.04.2026', 'РЗ'],
    ['501', 501, null],
    ['', null, null],
    ['Рз-1234.04.2026 год.', null, null, 'Рз'],
  ]
  for (const [raw, number, date, prefix] of cases) {
    it(`reads „${raw}“`, () => {
      const parsed = parseNumberWithDate(raw)
      expect(parsed.number).toBe(number)
      expect(parsed.date).toBe(date)
      expect(parsed.prefix).toBe(prefix ?? '')
    })
  }
})

describe('names', () => {
  it('keys like the old sheet: lower case, no spaces, no hyphens', () => {
    expect(nameKey('Иван Петров Иванов-Георгиев')).toBe(nameKey('ИВАН ПЕТРОВ ИВАНОВ - ГЕОРГИЕВ'))
    expect(nameKey('  Иван   Петров Иванов ')).toBe('иванпетровиванов')
  })
  it('folds Latin look-alikes, NFC and ѝ', () => {
    expect(nameKey('Ивaн Пeтров Ивaнов')).toBe(nameKey('Иван Петров Иванов'))
    expect(nameKey('ИВАН ПЕТРОВ ИВАНОВ'.replace('А', 'A'))).toBe(nameKey('Иван Петров Иванов'))
    expect(nameKey('Ѝва Петрова'.normalize('NFD'))).toBe(nameKey('Ива Петрова'))
  })
  it('cleans dashes and spaces for display', () => {
    expect(cleanName('Мария  Петрова – Иванова')).toBe('Мария Петрова-Иванова')
  })
  it('knows annulled rows', () => {
    expect(isAnnulledName('Анулиран')).toBe(true)
    expect(isAnnulledName('АНУЛИРАНО')).toBe(true)
    expect(isAnnulledName('Ани Петрова')).toBe(false)
  })
  it('edit distance caps', () => {
    expect(editDistance('василева', 'вссилева')).toBe(1)
    expect(editDistance('а', 'абвгдежзий', 3)).toBe(4)
  })
})

describe('dates, decisions, masked ЕГН', () => {
  it('normalizes dates', () => {
    expect(normalizeDate('9.1.2026')).toBe('09.01.2026')
    expect(normalizeDate('14.042026')).toBe('14.04.2026')
    expect(normalizeDate('32.01.2026')).toBeNull()
    expect(normalizeDate('nope')).toBeNull()
  })
  it('reads decision numbers', () => {
    expect(parseDecisionNumber('№ 69-ПВР / 20.10.2026')).toEqual({ number: 69, suffix: 'ПВР', date: '20.10.2026' })
    expect(parseDecisionNumber('Решение № 125-НС/16.04.2026')).toEqual({ number: 125, suffix: 'НС', date: '16.04.2026' })
    expect(parseDecisionNumber('№ 12-ПВР/НС от 01.11.2021')).toEqual({ number: 12, suffix: 'ПВР/НС', date: '01.11.2021' })
    expect(parseDecisionNumber('без номер')).toBeNull()
  })
  it('checks masked ЕГН against a full one', () => {
    expect(maskedEgnMatches('850101****', '8501011234')).toBe(true)
    expect(maskedEgnMatches('******1234', '8501011234')).toBe(true)
    expect(maskedEgnMatches('850102****', '8501011234')).toBe(false)
    expect(maskedEgnMatches('**********', '8501011234')).toBe(false)
  })
})

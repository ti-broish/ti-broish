import { describe, expect, it } from 'vitest'
import { CYRILLIC_MESSAGE, contactErrors, contactValid, nameError } from './contact-errors'

const ok = { firstName: 'Иван', middleName: 'Петров', lastName: 'Иванов', email: 'ivan@example.com', phone: '0888123456' }

describe('contact step messages', () => {
  it('says which field is empty', () => {
    expect(nameError('middleName', '')).toBe('Въведи презиме.')
    expect(nameError('firstName', '  ')).toBe('Въведи име.')
    expect(nameError('lastName', '')).toBe('Въведи фамилия.')
    expect(contactErrors({ ...ok, email: '', phone: '' })).toMatchObject({ email: 'Въведи имейл.', phone: 'Въведи телефон.' })
  })

  it('asks for Cyrillic names', () => {
    expect(nameError('firstName', 'Ivan')).toBe(CYRILLIC_MESSAGE)
    expect(nameError('lastName', 'Иvanов')).toBe(CYRILLIC_MESSAGE)
    expect(CYRILLIC_MESSAGE).toBe('Имената трябва да са на кирилица.')
  })

  it('keeps the rule: all three names, at least two letters each', () => {
    expect(nameError('middleName', 'П')).toBe('Напиши цялото презиме.')
    expect(contactValid({ ...ok, middleName: '' })).toBe(false)
    expect(contactValid(ok)).toBe(true)
    expect(Object.values(contactErrors(ok)).every((message) => message === '')).toBe(true)
  })

  it('flags a broken e-mail or phone', () => {
    expect(contactErrors({ ...ok, email: 'ivan@example' }).email).toMatch(/Провери имейла/)
    expect(contactErrors({ ...ok, phone: '0888' }).phone).toMatch(/Провери телефона/)
  })
})

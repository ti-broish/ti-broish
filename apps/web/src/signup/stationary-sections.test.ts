import { describe, expect, it } from 'vitest'
import { isSpecialBulgariaSection } from './stationary-sections'

describe('isSpecialBulgariaSection', () => {
  it('keeps an ordinary section and skips a mobile or hospital one', () => {
    expect(isSpecialBulgariaSection('192700011')).toBe(false)
    expect(isSpecialBulgariaSection('234615001')).toBe(false)
    expect(isSpecialBulgariaSection('192700211')).toBe(true)
    expect(isSpecialBulgariaSection('010300141')).toBe(true)
  })

  it('does not treat an abroad section as one of these', () => {
    expect(isSpecialBulgariaSection('320100001')).toBe(false)
    expect(isSpecialBulgariaSection('')).toBe(false)
  })
})

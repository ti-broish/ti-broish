import { describe, expect, it } from 'vitest'
import { signalOriginRecord } from './signal-origin-sql'

describe('signalOriginRecord', () => {
  it('keeps a known origin with an API violation id', () => {
    expect(signalOriginRecord({ violationId: '01JB7Z3V9Q8K2M4N6P8R0S2T4V', origin: 'IAZ' })).toEqual({
      violationId: '01JB7Z3V9Q8K2M4N6P8R0S2T4V',
      origin: 'iaz',
    })
  })

  it('refuses unknown origins and odd ids', () => {
    expect(signalOriginRecord({ violationId: '01JB7Z3V9Q8K2M4N6P8R0S2T4V', origin: 'other' })).toBeNull()
    expect(signalOriginRecord({ violationId: "1'; DROP TABLE x", origin: 'iaz' })).toBeNull()
    expect(signalOriginRecord({ violationId: 42, origin: 'iaz' })).toBeNull()
    expect(signalOriginRecord(null)).toBeNull()
  })
})

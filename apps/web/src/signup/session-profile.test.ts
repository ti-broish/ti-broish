import { describe, expect, it } from 'vitest'
import { emptyProfile } from './model'
import { profileStamp, sessionProfile } from './session-profile'

describe('session profile', () => {
  it('takes the server copy and does not keep a leftover local source', () => {
    const current = { ...emptyProfile(), firstName: 'Иван', source: 'old.example' }
    const remote = { ...emptyProfile(), firstName: 'Иван', email: 'ivan@example.com' }
    const next = sessionProfile(current, remote, null, { source: '', referredBy: '' }, profileStamp(current))
    expect(next.email).toBe('ivan@example.com')
    expect(next.source).toBe('')
  })

  it('fills an empty server source from the current address', () => {
    const current = { ...emptyProfile(), firstName: 'Иван' }
    const remote = { ...emptyProfile(), firstName: 'Иван' }
    const next = sessionProfile(current, remote, 'Мария', { source: 'iaz.bg', referredBy: 'abc123' }, profileStamp(current))
    expect(next.source).toBe('iaz.bg')
    expect(next.referredBy).toBe('abc123')
    expect(next.referrerName).toBe('Мария')
  })

  it('leaves a profile that changed while the session was loading', () => {
    const current = { ...emptyProfile(), firstName: 'Иван' }
    const edited = { ...current, firstName: 'Петър' }
    const remote = { ...emptyProfile(), firstName: 'Старо', email: 'old@example.com' }
    const next = sessionProfile(edited, remote, null, { source: 'iaz.bg', referredBy: '' }, profileStamp(current))
    expect(next).toBe(edited)
  })
})

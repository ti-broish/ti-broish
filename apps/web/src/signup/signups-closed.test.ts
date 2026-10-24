import { describe, expect, it } from 'vitest'
import { saveDecision } from './signup-guard'
import { SIGNUPS_CLOSED, SIGNUPS_CLOSED_MESSAGE, refusesNewCodeRequest, refusesNewSignup } from './signups-closed'

const sessionRow = { id: 'row-1', email: 'own@example.test', session_token: 't', imported: 0, email_confirmed: 1 }

describe('signups closed', () => {
  it('is closed by default (no VITE_SIGNUPS_OPEN)', () => {
    expect(SIGNUPS_CLOSED).toBe(true)
    expect(SIGNUPS_CLOSED_MESSAGE).toContain('Записването на доброволци приключи')
  })

  it('refuses a save that would create a new record', () => {
    const decision = saveDecision('new@example.test', null, null)
    expect(decision.kind).toBe('new')
    expect(refusesNewSignup(decision.kind)).toBe(true)
  })

  it('still lets a person save their own record from their session', () => {
    const decision = saveDecision('own@example.test', sessionRow, { ...sessionRow })
    expect(decision.kind).toBe('own')
    expect(refusesNewSignup(decision.kind)).toBe(false)
  })

  it('reopens with the flag off', () => {
    expect(refusesNewSignup('new', false)).toBe(false)
    expect(refusesNewCodeRequest(false, false)).toBe(false)
  })

  it('sends a signup code only to an address that already has a record', () => {
    expect(refusesNewCodeRequest(false)).toBe(true)
    expect(refusesNewCodeRequest(true)).toBe(false)
  })
})

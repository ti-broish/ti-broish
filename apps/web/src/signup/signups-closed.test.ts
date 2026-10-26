import { describe, expect, it } from 'vitest'
import { saveDecision } from './signup-guard'
import { SIGNUPS_CLOSED_MESSAGE, SIGNUPS_CLOSE_AT, refusesNewCodeRequest, refusesNewSignup, signupsClosed, signupsOpen } from './signups-closed'

const sessionRow = { id: 'row-1', email: 'own@example.test', session_token: 't', imported: 0, email_confirmed: 1 }

// 31.10.2026 09:00 Sofia (UTC+2 after the clock change on 25.10) = 07:00 UTC.
const BEFORE = new Date('2026-10-31T06:59:59Z')
const AT = new Date('2026-10-31T07:00:00Z')
const AFTER = new Date('2026-11-01T10:00:00Z')

describe('signups switch (SIGNUPS_CLOSE_AT)', () => {
  it('closes on Saturday 31.10.2026 at 09:00 Sofia', () => {
    expect(SIGNUPS_CLOSE_AT).toBe('2026-10-31T09:00:00+02:00')
    expect(new Date(SIGNUPS_CLOSE_AT).toISOString()).toBe('2026-10-31T07:00:00.000Z')
  })

  it('is open before the cutoff and closed from it on', () => {
    expect(signupsOpen(new Date('2026-10-26T12:00:00Z'))).toBe(true)
    expect(signupsOpen(BEFORE)).toBe(true)
    expect(signupsOpen(AT)).toBe(false)
    expect(signupsOpen(AFTER)).toBe(false)
    expect(signupsClosed(BEFORE)).toBe(false)
    expect(signupsClosed(AT)).toBe(true)
    expect(SIGNUPS_CLOSED_MESSAGE).toContain('Записването на доброволци приключи')
  })

  it('server: a new record is saved and gets a code before the cutoff', () => {
    const decision = saveDecision('new@example.test', null, null)
    expect(decision.kind).toBe('new')
    expect(refusesNewSignup(decision.kind, signupsClosed(BEFORE))).toBe(false)
    expect(refusesNewCodeRequest(false, signupsClosed(BEFORE))).toBe(false)
  })

  it('server: from the cutoff a new record is refused and gets no code', () => {
    const decision = saveDecision('new@example.test', null, null)
    expect(refusesNewSignup(decision.kind, signupsClosed(AT))).toBe(true)
    expect(refusesNewCodeRequest(false, signupsClosed(AT))).toBe(true)
  })

  it('after the cutoff a person still saves their own record and signs in by code', () => {
    const decision = saveDecision('own@example.test', sessionRow, { ...sessionRow })
    expect(decision.kind).toBe('own')
    expect(refusesNewSignup(decision.kind, signupsClosed(AFTER))).toBe(false)
    expect(refusesNewCodeRequest(true, signupsClosed(AFTER))).toBe(false)
  })

  it('reads the clock on every call (the default is now)', () => {
    expect(signupsClosed()).toBe(!signupsOpen())
  })
})

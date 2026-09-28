import { describe, expect, it } from 'vitest'
import { sessionCookieSecure } from './session-cookie'

describe('session cookie', () => {
  it('stays readable on the local http hosts and secure everywhere else', () => {
    expect(sessionCookieSecure('127.0.0.1:3000')).toBe(false)
    expect(sessionCookieSecure('localhost')).toBe(false)
    expect(sessionCookieSecure('::1')).toBe(false)
    expect(sessionCookieSecure('[::1]:3000')).toBe(false)
    expect(sessionCookieSecure('d1t.tibroish.bg')).toBe(true)
    expect(sessionCookieSecure('')).toBe(true)
  })
})

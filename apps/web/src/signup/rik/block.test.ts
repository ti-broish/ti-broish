import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectBlock, parseRetryAfter } from './block'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const CHALLENGE = fixture('cf-challenge-403.html')
const REGISTER = fixture('rik01-pvr2026-list-empty.html')
const now = new Date('2026-10-21T18:00:00Z')
const headers = (init: Record<string, string> = {}) => new Headers(init)

describe('detectBlock (challenge and block pages from *.cik.bg)', () => {
  it('recognises Cloudflare’s managed challenge (403 + cf-mitigated, „Just a moment…“)', () => {
    expect(detectBlock({ status: 403, headers: headers({ 'cf-mitigated': 'challenge' }), body: CHALLENGE }, now)?.reason).toContain('cf-mitigated')
  })
  it('recognises the challenge HTML without the header, also behind 200 and 503', () => {
    for (const status of [200, 403, 503]) expect(detectBlock({ status, headers: headers(), body: CHALLENGE }, now)?.reason).toMatch(/challenge/i)
  })
  it('treats 403 and 429 as blocks and reads Retry-After', () => {
    expect(detectBlock({ status: 403, headers: headers(), body: '' }, now)).not.toBeNull()
    expect(detectBlock({ status: 429, headers: headers({ 'retry-after': '120' }), body: '' }, now)).toEqual({ reason: 'HTTP 429, твърде много заявки', retryAfterMs: 120_000 })
  })
  it('does not flag a real register page or a plain 5xx outage', () => {
    expect(detectBlock({ status: 200, headers: headers(), body: REGISTER }, now)).toBeNull()
    expect(detectBlock({ status: 503, headers: headers(), body: 'Service Unavailable' }, now)).toBeNull()
    expect(detectBlock({ status: 520, headers: headers(), body: '' }, now)).toBeNull()
  })
  it('parses Retry-After as seconds or an HTTP date', () => {
    expect(parseRetryAfter('30', now)).toBe(30_000)
    expect(parseRetryAfter('Wed, 21 Oct 2026 18:05:00 GMT', now)).toBe(300_000)
    expect(parseRetryAfter(null, now)).toBeNull()
  })
})

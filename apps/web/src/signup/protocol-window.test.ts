import { describe, expect, it } from 'vitest'
import { tiBroishApi } from './api-base'
import { bgDateTime, currentOrNextProtocolWindow, isProtocolOpen, protocolWindows, sofiaDay } from './election'
import { fetchElectionEnd } from './protocol-window'

// Sofia is UTC+3 until 04:00 on 25.10.2026 and UTC+2 after, so 20:00 Sofia on 25.10 is 18:00Z.
describe('protocol window', () => {
  it('opens at 20:00 Sofia on election day, not before', () => {
    expect(isProtocolOpen(new Date('2026-10-24T21:30:00Z'))).toBe(false) // 25.10 00:30 Sofia
    expect(isProtocolOpen(new Date('2026-10-25T05:00:00Z'))).toBe(false) // 07:00, polls open
    expect(isProtocolOpen(new Date('2026-10-25T17:59:59Z'))).toBe(false) // 19:59:59
    expect(isProtocolOpen(new Date('2026-10-25T18:00:00Z'))).toBe(true) // 20:00
    expect(isProtocolOpen(new Date('2026-10-25T21:59:00Z'))).toBe(true) // 23:59
  })

  it('stays open through the night and closes at 12:00 Sofia the next day', () => {
    expect(isProtocolOpen(new Date('2026-10-25T22:00:00Z'))).toBe(true) // 26.10 00:00
    expect(isProtocolOpen(new Date('2026-10-26T01:00:00Z'))).toBe(true) // 03:00
    expect(isProtocolOpen(new Date('2026-10-26T09:59:59Z'))).toBe(true) // 11:59:59
    expect(isProtocolOpen(new Date('2026-10-26T10:00:00Z'))).toBe(false) // 12:00
    expect(isProtocolOpen(new Date('2026-10-28T12:00:00Z'))).toBe(false)
  })

  it('opens again for the runoff on 01.11 20:00 until 02.11 12:00', () => {
    expect(isProtocolOpen(new Date('2026-11-01T17:59:00Z'))).toBe(false)
    expect(isProtocolOpen(new Date('2026-11-01T18:00:00Z'))).toBe(true)
    expect(isProtocolOpen(new Date('2026-11-01T22:30:00Z'))).toBe(true)
    expect(isProtocolOpen(new Date('2026-11-02T10:00:00Z'))).toBe(false)
  })

  it('takes the opening time from the API meta only when it falls on an election day', () => {
    expect(isProtocolOpen(new Date('2026-10-25T18:00:00Z'), '2026-10-25T20:00:00+02:00')).toBe(true)
    expect(isProtocolOpen(new Date('2026-10-25T18:30:00Z'), '2026-10-25T21:00:00+02:00')).toBe(false)
    expect(isProtocolOpen(new Date('2026-10-25T19:00:00Z'), '2026-10-25T21:00:00+02:00')).toBe(true)
    // The staging API still has April's meta; it is ignored.
    expect(isProtocolOpen(new Date('2026-10-25T18:00:00Z'), '2026-04-19T20:00:00+03:00')).toBe(true)
    expect(isProtocolOpen(new Date('2026-10-25T12:00:00Z'), '2026-04-19T20:00:00+03:00')).toBe(false)
    expect(isProtocolOpen(new Date('2026-10-25T18:00:00Z'), 'not a date')).toBe(true)
    expect(protocolWindows('2026-10-25T20:00:00+02:00')[0].opens.toISOString()).toBe('2026-10-25T18:00:00.000Z')
  })

  it('names the next opening for the closed page', () => {
    const before = currentOrNextProtocolWindow(new Date('2026-10-25T11:00:00Z'))
    expect(before && bgDateTime(before.opens)).toBe('20:00 ч. на 25 октомври')
    expect(before && bgDateTime(before.closes)).toBe('12:00 ч. на 26 октомври')
    const between = currentOrNextProtocolWindow(new Date('2026-10-27T11:00:00Z'))
    expect(between?.day).toBe('2026-11-01')
    expect(currentOrNextProtocolWindow(new Date('2026-11-03T00:00:00Z'))).toBeNull()
    expect(sofiaDay(new Date('2026-10-25T21:59:00Z'))).toBe('2026-10-25')
  })

  it('reads endOfElectionDayTimestamp from /results/meta.json and survives a failing API', async () => {
    const urls: string[] = []
    const end = await fetchElectionEnd(async (url) => {
      urls.push(url)
      return new Response(JSON.stringify({ name: 'x', endOfElectionDayTimestamp: '2026-10-25T20:00:00+02:00' }), { status: 200 })
    }, 'https://api.tibroish.bg')
    expect(urls).toEqual(['https://api.tibroish.bg/results/meta.json'])
    expect(end).toBe('2026-10-25T20:00:00+02:00')
    expect(await fetchElectionEnd(async () => new Response('nope', { status: 502 }), 'https://api.tibroish.bg')).toBeNull()
    expect(await fetchElectionEnd(async () => Promise.reject(new Error('offline')), 'https://api.tibroish.bg')).toBeNull()
  })
})

describe('API base', () => {
  it('sends to the production API only from tibroish.bg', () => {
    expect(tiBroishApi('tibroish.bg', '')).toBe('https://api.tibroish.bg')
    expect(tiBroishApi('www.tibroish.bg', '')).toBe('https://api.tibroish.bg')
    expect(tiBroishApi('d1t.tibroish.bg', '')).toBe('https://d1tapi.tibroish.bg')
    expect(tiBroishApi('abc-ti-broish-web-staging.example.workers.dev', '')).toBe('https://d1tapi.tibroish.bg')
    expect(tiBroishApi('127.0.0.1', '')).toBe('https://d1tapi.tibroish.bg')
    expect(tiBroishApi('tibroish.bg', 'https://example.test/api/')).toBe('https://example.test/api')
  })
})

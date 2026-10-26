import { describe, expect, it } from 'vitest'
import { addDays, bgDateTime, bgLastDay, currentOrNextProtocolWindow, endOfSofiaDay, isProtocolOpen, protocolWindows, sofiaDay } from './election'
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

  it('stays open until the end of the third day after election day (28.10 23:59:59 Sofia)', () => {
    expect(isProtocolOpen(new Date('2026-10-25T22:00:00Z'))).toBe(true) // 26.10 00:00
    expect(isProtocolOpen(new Date('2026-10-26T10:00:00Z'))).toBe(true) // 26.10 12:00, the old cut-off
    expect(isProtocolOpen(new Date('2026-10-27T12:00:00Z'))).toBe(true) // 27.10 14:00
    expect(isProtocolOpen(new Date('2026-10-28T21:00:00Z'))).toBe(true) // 28.10 23:00
    expect(isProtocolOpen(new Date('2026-10-28T21:59:59Z'))).toBe(true) // 28.10 23:59:59
    expect(isProtocolOpen(new Date('2026-10-28T22:00:00Z'))).toBe(false) // 29.10 00:00
    expect(isProtocolOpen(new Date('2026-10-29T10:00:00Z'))).toBe(false) // 29.10 12:00
    expect(protocolWindows()[0].closes.toISOString()).toBe('2026-10-28T22:00:00.000Z')
  })

  it('gives the runoff the same rule: 01.11 20:00 until the end of 04.11', () => {
    expect(isProtocolOpen(new Date('2026-11-01T17:59:00Z'))).toBe(false)
    expect(isProtocolOpen(new Date('2026-11-01T18:00:00Z'))).toBe(true)
    expect(isProtocolOpen(new Date('2026-11-02T10:00:00Z'))).toBe(true)
    expect(isProtocolOpen(new Date('2026-11-04T21:59:59Z'))).toBe(true)
    expect(isProtocolOpen(new Date('2026-11-04T22:00:00Z'))).toBe(false)
  })

  it('ends at Sofia midnight across the summer-time change too', () => {
    expect(endOfSofiaDay('2026-10-28').toISOString()).toBe('2026-10-28T22:00:00.000Z')
    expect(endOfSofiaDay('2026-07-01').toISOString()).toBe('2026-07-01T21:00:00.000Z')
    expect(endOfSofiaDay('2026-10-24').toISOString()).toBe('2026-10-24T21:00:00.000Z') // 25.10 00:00 is still UTC+3
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
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
    expect(before && bgLastDay(before.closes)).toBe('28 октомври')
    const between = currentOrNextProtocolWindow(new Date('2026-10-30T11:00:00Z'))
    expect(between?.day).toBe('2026-11-01')
    expect(currentOrNextProtocolWindow(new Date('2026-11-05T00:00:00Z'))).toBeNull()
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

import { beforeEach, describe, expect, it } from 'vitest'
import { demoItems } from './demo'
import { REGION_PATHS } from './region-paths'
import { REGION_CODES } from './regions'
import { countItems, inSegment, regionOf, toFeedItem, validAfter, validSegment, type ApiViolation } from './violations'
import { clearViolationsCache, demoAllowed, handleViolations, loadOverview } from './violations.server'

const town = (regions: string[], extra: Partial<NonNullable<ApiViolation['town']>> = {}) => ({
  code: 1,
  name: 'Град',
  country: { code: '000', name: 'България', isAbroad: false },
  municipality: { code: '46', name: 'Община', electionRegions: regions.map((code) => ({ code, name: code, isAbroad: false })) },
  cityRegions: [],
  ...extra,
})

function item(id: string, patch: Partial<ApiViolation> = {}): ApiViolation {
  return { id, type: 'standard', status: 'processed', publishedText: ' Текст ', createdAt: '2026-10-25T08:00:00.000Z', town: town(['16']), section: null, ...patch }
}

const ULID = '01JZ0000000000000000000000'

describe('violations on the map', () => {
  it('places a signal by its section, then by a single-МИР town, then abroad', () => {
    expect(regionOf(item(ULID, { section: { id: '234612001' }, town: town(['23', '24', '25']) }))).toBe('23')
    expect(regionOf(item(ULID))).toBe('16')
    expect(regionOf(item(ULID, { town: town(['23', '24', '25']) }))).toBeNull()
    expect(regionOf(item(ULID, { town: town([], { country: { code: '276', name: 'Германия', isAbroad: true }, municipality: null }) }))).toBe('32')
  })

  it('keeps only public fields and counts by region and municipality', () => {
    const feed = [
      toFeedItem(item('a', { section: { id: '234612001', code: '001', place: 'училище' } })),
      toFeedItem(item('b', { section: { id: '234615002' } })),
      toFeedItem(item('c')),
      toFeedItem(item('d', { town: town(['23', '24', '25']) })),
    ]
    expect(Object.keys(feed[0]).sort()).toEqual(
      ['country', 'createdAt', 'id', 'municipality', 'municipalityKey', 'place', 'region', 'section', 'text', 'town', 'video'].sort(),
    )
    expect(feed[0].text).toBe('Текст')
    const counts = countItems(feed)
    expect(counts).toMatchObject({ total: 4, regions: { '23': 2, '16': 1 }, unplaced: 1 })
    expect(counts.municipalities['2346'].count).toBe(2)
    expect(counts.municipalities['1646'].count).toBe(1)
    expect(inSegment(feed[0], '23')).toBe(true)
    expect(inSegment(feed[0], '234612')).toBe(true)
    expect(inSegment(feed[1], '234612')).toBe(false)
    expect(inSegment(feed[2], '1646')).toBe(true)
  })

  it('accepts only section-code segments and ULIDs', () => {
    for (const ok of ['01', '31', '32', '2346', '234612', '234612001', '32276']) expect(validSegment(ok)).toBe(true)
    for (const bad of ['00', '33', '1', '123', '23461', '2346120011', '../x', '']) expect(validSegment(bad)).toBe(false)
    expect(validAfter(ULID)).toBe(true)
    expect(validAfter('x; drop')).toBe(false)
  })

  it('has an outline for every МИР', () => {
    expect(Object.keys(REGION_PATHS).sort()).toEqual([...REGION_CODES].sort())
  })
})

describe('/api/violations', () => {
  beforeEach(() => clearViolationsCache())
  const noWait = () => undefined

  it('pages the full feed for the counts and caches the result', async () => {
    let calls = 0
    const pages: Record<string, ApiViolation[]> = {
      '/violations/feed': Array.from({ length: 50 }, (_, i) => item(`01JZ${String(i).padStart(22, '0')}`)),
      [`/violations/feed?after=01JZ${String(49).padStart(22, '0')}`]: [item('01JZZZZZZZZZZZZZZZZZZZZZZZ', { section: { id: '010300001' } })],
    }
    const fetcher = async (url: string) => {
      calls += 1
      const path = url.replace('https://api.tibroish.bg', '')
      return new Response(JSON.stringify(pages[path] ?? []))
    }
    const overview = await loadOverview(fetcher)
    expect(overview.items).toHaveLength(50)
    expect(overview.counts).toMatchObject({ total: 51, regions: { '16': 50, '01': 1 } })
    expect(overview.more).toBe(true)

    calls = 0
    const request = new Request('https://d1t.tibroish.bg/api/violations')
    const first = await handleViolations(request, {}, noWait, fetcher)
    expect(first.status).toBe(200)
    await handleViolations(request, {}, noWait, fetcher)
    expect(calls).toBe(2)
  })

  it('shows the empty feed as an empty list', async () => {
    const response = await handleViolations(new Request('https://tibroish.bg/api/violations'), {}, noWait, async () => new Response('[]'))
    expect(await response.json()).toMatchObject({ items: [], more: false, counts: { total: 0 } })
  })

  it('rejects bad parameters and reports API failures', async () => {
    const ok = async () => new Response('[]')
    expect((await handleViolations(new Request('https://x/api/violations?segment=99'), {}, noWait, ok)).status).toBe(400)
    expect((await handleViolations(new Request('https://x/api/violations?after=bad'), {}, noWait, ok)).status).toBe(400)
    const down = async () => new Response('nope', { status: 500 })
    expect((await handleViolations(new Request('https://x/api/violations?segment=23'), {}, noWait, down)).status).toBe(502)
  })

  it('never serves sample data in production', async () => {
    const env = { ALLOW_DEMO_DATA: '1' }
    expect(demoAllowed(env, new URL('https://tibroish.bg/?demo=1'))).toBe(false)
    expect(demoAllowed(env, new URL('https://www.tibroish.bg/?demo=1'))).toBe(false)
    expect(demoAllowed({}, new URL('https://d1t.tibroish.bg/?demo=1'))).toBe(false)
    expect(demoAllowed(env, new URL('https://d1t.tibroish.bg/?demo=1'))).toBe(true)
    const fail = async () => {
      throw new Error('no upstream for demo')
    }
    // In production ?demo=1 is ignored: it asks the real API (here down, so 502) and never returns samples.
    const prod = await handleViolations(new Request('https://tibroish.bg/api/violations?demo=1'), env, noWait, fail)
    expect(prod.status).toBe(502)
    expect(((await prod.json()) as { demo?: boolean }).demo).toBeUndefined()
    const staging = await handleViolations(new Request('https://d1t.tibroish.bg/api/violations?demo=1'), env, noWait, fail)
    const body = (await staging.json()) as { demo: boolean; items: { demo: boolean; text: string }[] }
    expect(body.demo).toBe(true)
    expect(body.items.length).toBeGreaterThan(20)
    expect(body.items.every((entry) => entry.demo && entry.text.startsWith('Примерен сигнал'))).toBe(true)
  })

  it('makes sample signals in many regions', () => {
    const regions = new Set(demoItems().map((entry) => entry.region))
    expect(regions.size).toBeGreaterThan(15)
  })
})

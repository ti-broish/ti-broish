import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUnit, loadViolation, publicViolation } from './results.server'
import { clearViolationsCache } from './violations.server'

const noWait = () => undefined

describe('results proxy', () => {
  beforeEach(() => clearViolationsCache())

  it('fetches a unit once and serves it from cache', async () => {
    const fetcher = vi.fn(async (_url: string) => Response.json({ segment: '24', name: 'София 24 МИР' }))
    expect((await loadUnit('24', noWait, fetcher))?.name).toBe('София 24 МИР')
    expect((await loadUnit('24', noWait, fetcher))?.name).toBe('София 24 МИР')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/\/results\/24\.json$/)
  })

  it('answers null for a unit the API does not have, and for codes it never asks about', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 }))
    expect(await loadUnit('2446', noWait, fetcher)).toBeNull()
    expect(await loadUnit('../x', noWait, fetcher)).toBeNull()
    expect(await loadUnit('meta', noWait, fetcher)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('throws when the API fails, so the page can say so instead of „not found“', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 502 }))
    await expect(loadUnit('25', noWait, fetcher)).rejects.toThrow()
  })

  it('keeps only the public fields of a signal', () => {
    const view = publicViolation({
      id: '01K',
      description: 'private',
      publishedText: 'Публикуван текст',
      statusLocalized: 'Публикуван',
      createdAt: '2026-10-25T07:30:00.000Z',
      author: { email: 'someone@example.com' },
      section: { id: '244601001', place: 'x', electionRegion: { code: '24', name: 'София 24 МИР', isAbroad: false } },
      town: { name: 'гр.София', country: { name: 'България', isAbroad: false }, municipality: { name: 'Столична', electionRegions: [] } },
      pictures: [{ url: 'https://example.test/a.jpg', id: 'p' }],
    })
    expect(JSON.stringify(view)).not.toContain('private')
    expect(JSON.stringify(view)).not.toContain('example.com')
    expect(view.section).toEqual({ id: '244601001', electionRegion: { code: '24', name: 'София 24 МИР' } })
    expect(view.pictures).toEqual([{ url: 'https://example.test/a.jpg' }])
  })

  it('shows a signal only once it is published', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: '01KAAAAAAAAAAAAAAAAAAAAAA1', publishedText: null }))
    expect(await loadViolation('01KAAAAAAAAAAAAAAAAAAAAAA1', noWait, fetcher)).toBeNull()
    expect(await loadViolation('not-an-id', noWait, fetcher)).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({ env: {} }))

import { BrevoApiError, fetchBrevoList, fetchBrevoLists, type BrevoConfig } from './brevo'
import { brevoListLabel, parseBrevoLists } from './brevo-lists'

const config: BrevoConfig = {
  apiKey: 'test-key',
  listId: 94,
  templateId: null,
  senderEmail: 'team@tibroish.bg',
  senderName: 'Ти броиш',
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('parseBrevoLists', () => {
  it('maps subscribers and sorts newest first', () => {
    const lists = parseBrevoLists({
      count: 3,
      lists: [
        { id: 10, name: 'Old', uniqueSubscribers: 2, totalSubscribers: 5 },
        { id: 30, name: 'New', totalSubscribers: 7 },
        { id: 20, name: 'Mid', uniqueSubscribers: 1 },
      ],
    })
    expect(lists).toEqual([
      { id: 30, name: 'New', subscribers: 7 },
      { id: 20, name: 'Mid', subscribers: 1 },
      { id: 10, name: 'Old', subscribers: 2 },
    ])
  })

  it('skips invalid rows and prefers uniqueSubscribers', () => {
    expect(
      parseBrevoLists({
        lists: [
          { id: 1, name: 'A', uniqueSubscribers: 4, totalSubscribers: 9 },
          { id: 'x', name: 'bad' },
          { name: 'no-id' },
          null,
        ],
      }),
    ).toEqual([{ id: 1, name: 'A', subscribers: 4 }])
  })
})

describe('brevoListLabel', () => {
  it('uses singular контакт for 1', () => {
    expect(brevoListLabel({ name: 'ТЕСТ', subscribers: 1 })).toBe('ТЕСТ (1 контакт)')
  })

  it('uses контакта otherwise', () => {
    expect(brevoListLabel({ name: 'ТЕСТ ti-broish staging', subscribers: 94 })).toBe(
      'ТЕСТ ti-broish staging (94 контакта)',
    )
    expect(brevoListLabel({ name: 'Empty', subscribers: 0 })).toBe('Empty (0 контакта)')
  })
})

describe('fetchBrevoLists', () => {
  it('paginates until count is covered', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const offset = Number(new URL(url).searchParams.get('offset') ?? '0')
      const page = Array.from({ length: 50 }, (_, index) => {
        const id = 120 - offset - index
        return { id, name: `List ${id}`, uniqueSubscribers: id }
      }).filter((row) => row.id >= 1)
      return jsonResponse(200, { lists: page, count: 120 })
    })

    const lists = await fetchBrevoLists(config, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]))
    expect(urls[0]).toContain('offset=0')
    expect(urls[1]).toContain('offset=50')
    expect(urls[2]).toContain('offset=100')
    expect(urls.every((url) => url.includes('limit=50') && url.includes('sort=desc'))).toBe(true)
    expect(lists).toHaveLength(120)
    expect(lists[0]?.id).toBe(120)
    expect(lists[119]?.id).toBe(1)
  })
})

describe('fetchBrevoList', () => {
  it('returns id, name and subscribers', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { id: 94, name: 'ТЕСТ ti-broish staging', uniqueSubscribers: 94, totalSubscribers: 100 }),
    )
    await expect(fetchBrevoList(config, 94, fetchImpl)).resolves.toEqual({
      id: 94,
      name: 'ТЕСТ ti-broish staging',
      subscribers: 94,
    })
  })

  it('maps 404 to a Bulgarian missing-list message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { message: 'List Id does not exist', code: 'invalid_parameter' }))
    await expect(fetchBrevoList(config, 999, fetchImpl)).rejects.toMatchObject({
      name: 'BrevoApiError',
      status: 404,
      message: 'Списък 999 не съществува в Brevo.',
    })
    await expect(fetchBrevoList(config, 999, fetchImpl)).rejects.toBeInstanceOf(BrevoApiError)
  })
})

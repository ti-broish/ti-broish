import { describe, expect, it } from 'vitest'
import { pushSectionContact } from './designation-brevo'

type Call = { method: string; url: string; body: Record<string, unknown> | null }

function fake(responses: number[], calls: Call[]) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null })
    const status = responses.shift() ?? 204
    return new Response(status === 404 ? JSON.stringify({ code: 'document_not_found' }) : status >= 400 ? JSON.stringify({ message: 'bad' }) : null, { status })
  }) as typeof fetch
}

describe('pushSectionContact (contact upsert only)', () => {
  it('updates the contact and puts it on the list', async () => {
    const calls: Call[] = []
    const result = await pushSectionContact({ apiKey: 'k', listId: 95, personId: 's1', email: 'a@example.test', attributes: { SECTION_ID_TEXT: '234600001' }, fetchImpl: fake([204], calls) })
    expect(result).toEqual({ personId: 's1', ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { attributes: { SECTION_ID_TEXT: '234600001' }, listIds: [95] } })
  })

  it('creates the contact when Brevo does not know it', async () => {
    const calls: Call[] = []
    const result = await pushSectionContact({ apiKey: 'k', listId: 95, personId: 's1', email: 'a@example.test', attributes: { SECTION_ID_TEXT: '234600001' }, fetchImpl: fake([404, 201], calls) })
    expect(result).toEqual({ personId: 's1', ok: true, created: true })
    expect(calls.map((call) => call.method)).toEqual(['PUT', 'POST'])
    expect(calls[1]!.url).toMatch(/\/contacts$/)
    expect(calls[1]!.body).toMatchObject({ email: 'a@example.test', listIds: [95] })
  })

  it('reports other errors and never sends without attributes', async () => {
    const calls: Call[] = []
    expect((await pushSectionContact({ apiKey: 'k', listId: 95, personId: 's1', email: 'a@example.test', attributes: { X: '1' }, fetchImpl: fake([400], calls) })).ok).toBe(false)
    const before = calls.length
    expect(await pushSectionContact({ apiKey: 'k', listId: 95, personId: 's1', email: 'a@example.test', attributes: {}, fetchImpl: fake([], calls) })).toMatchObject({ ok: false })
    expect(calls.length).toBe(before)
  })
})

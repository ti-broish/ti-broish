import { describe, expect, it } from 'vitest'
import { checkProtocol, fetchOwnProtocol, protocolStatusLabel, sendProtocol } from './protocol-api'

const API = 'https://d1tapi.tibroish.bg'
const jpeg = { contentType: 'image/jpeg', data: `/9j/${'A'.repeat(40)}` }
const four = [jpeg, jpeg, jpeg, jpeg]

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

function fakeApi(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch = async (url: string, init?: RequestInit) => {
    const call = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    return handler(call, calls.length - 1)
  }
  return { calls, fetch }
}

describe('protocol to the API', () => {
  it('needs at least 4 JPEG photos and a valid email if one is given', () => {
    expect(checkProtocol('', [jpeg, jpeg, jpeg])).toMatch(/4/)
    expect(checkProtocol('', four)).toBeNull()
    expect(checkProtocol('not-an-email', four)).toMatch(/Имейл/)
    expect(checkProtocol('', [...four.slice(1), { contentType: 'image/png', data: jpeg.data }])).toMatch(/Снимката/)
    expect(checkProtocol('', Array(13).fill(jpeg))).toMatch(/12/)
  })

  it('uploads each photo, creates the protocol with the picture ids, then saves the email', async () => {
    const api = fakeApi((call, index) => {
      if (call.url.endsWith('/pictures')) return json(201, { id: `pic-${index}`, url: `https://x/${index}.jpg` })
      if (call.url.endsWith('/protocols')) return json(201, { id: 'proto-1', secret: 's3cret', pictures: [] })
      return new Response('', { status: 202 })
    })
    const tokens: string[] = []
    const result = await sendProtocol('Ivan@example.com ', four, {
      fetch: api.fetch,
      api: API,
      recaptcha: async (action) => {
        tokens.push(action)
        return `token-${action}`
      },
    })
    expect(result).toEqual({ ok: true, id: 'proto-1', secret: 's3cret', pictureCount: 4, contactSaved: true })
    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${API}/pictures`,
      `POST ${API}/pictures`,
      `POST ${API}/pictures`,
      `POST ${API}/pictures`,
      `POST ${API}/protocols`,
      `PATCH ${API}/protocols/proto-1/contact`,
    ])
    expect(api.calls[0].body).toEqual({ image: `data:image/jpeg;base64,${jpeg.data}` })
    expect(api.calls[4].body).toEqual({ pictures: ['pic-0', 'pic-1', 'pic-2', 'pic-3'] })
    expect(api.calls[5].body).toEqual({ email: 'Ivan@example.com', secret: 's3cret' })
    expect(tokens).toEqual(['sendProtocolImage', 'sendProtocolImage', 'sendProtocolImage', 'sendProtocolImage', 'sendProtocol', 'sendProtocolEmail'])
    expect(api.calls[4].headers['x-recaptcha-token']).toBe('token-sendProtocol')
  })

  it('skips the contact call without an email and sends no captcha header without a site key', async () => {
    const api = fakeApi((call, index) => (call.url.endsWith('/pictures') ? json(201, { id: `pic-${index}` }) : json(201, { id: 'p2', secret: 's' })))
    const result = await sendProtocol('', four, { fetch: api.fetch, api: API })
    expect(result).toMatchObject({ ok: true, id: 'p2', contactSaved: null })
    expect(api.calls).toHaveLength(5)
    expect(api.calls.every((call) => !('x-recaptcha-token' in call.headers))).toBe(true)
  })

  it('still reports the protocol as sent when only the email fails', async () => {
    const api = fakeApi((call, index) => {
      if (call.url.endsWith('/pictures')) return json(201, { id: `pic-${index}` })
      if (call.url.endsWith('/protocols')) return json(201, { id: 'p3', secret: 's' })
      return json(429, { message: 'ThrottlerException' })
    })
    expect(await sendProtocol('ivan@example.com', four, { fetch: api.fetch, api: API })).toMatchObject({ ok: true, id: 'p3', contactSaved: false })
  })

  it('stops at the first failed photo and does not create a protocol', async () => {
    const api = fakeApi((_call, index) => (index === 1 ? json(413, {}) : json(201, { id: `pic-${index}` })))
    const result = await sendProtocol('', four, { fetch: api.fetch, api: API })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toMatch(/Снимките не се качиха/)
    expect(api.calls).toHaveLength(2)
  })

  it('turns a network error or a 500 on create into a message, never a hang', async () => {
    const offline = await sendProtocol('', four, { fetch: async () => Promise.reject(new Error('offline')), api: API })
    expect(offline).toEqual({ ok: false, message: expect.stringMatching(/Протоколът не беше изпратен/) })
    const api = fakeApi((call, index) => (call.url.endsWith('/pictures') ? json(201, { id: `pic-${index}` }) : json(500, {})))
    const failed = await sendProtocol('', four, { fetch: api.fetch, api: API })
    expect(failed).toEqual({ ok: false, message: 'Протоколът не беше изпратен. Системата не отговаря, опитай пак след малко.' })
  })

  it('reads the own protocol back with its secret', async () => {
    const api = fakeApi(() => json(200, { id: 'p1', status: 'received', createdAt: '2026-10-25T18:05:00Z', pictures: [{ url: 'https://x/1.jpg' }, {}] }))
    const protocol = await fetchOwnProtocol('p1', 'se cret', api.fetch, API)
    expect(api.calls[0].url).toBe(`${API}/protocols/p1?secret=se%20cret`)
    expect(protocol).toEqual({ id: 'p1', status: 'received', createdAt: '2026-10-25T18:05:00Z', sectionId: '', pictures: ['https://x/1.jpg'] })
    expect(await fetchOwnProtocol('p1', '', api.fetch, API)).toBeNull()
    expect(protocolStatusLabel('published')).toBe('Приет')
    expect(protocolStatusLabel('whatever')).toBe('Получен')
  })
})

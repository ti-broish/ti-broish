import { describe, expect, it } from 'vitest'
import { syncDesignationLinks, updateBrevoContactAttribute } from './designation-brevo'

describe('designation Brevo attribute', () => {
  it('updates the contact by email with the configured attribute', async () => {
    const calls: Array<{ url: string; body: string; apiKey: string }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: String(init?.body ?? ''),
        apiKey: String((init?.headers as Record<string, string>)['api-key'] ?? ''),
      })
      return new Response(null, { status: 204 })
    }
    await updateBrevoContactAttribute('secret-key', 'ivan@example.com', { DOCUMENT_URL: 'https://drive.example/file' }, fetchImpl)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.brevo.com/v3/contacts/ivan%40example.com?identifierType=email_id')
    expect(calls[0]?.body).toBe(JSON.stringify({ attributes: { DOCUMENT_URL: 'https://drive.example/file' } }))
    expect(calls[0]?.apiKey).toBe('secret-key')
  })

  it('surfaces a Brevo error message', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: 'contact not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
    await expect(updateBrevoContactAttribute('k', 'missing@example.com', { DOCUMENT_URL: 'x' }, fetchImpl)).rejects.toThrow('contact not found')
  })
})

describe('syncDesignationLinks', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const attributes = json({ attributes: [{ name: 'DOCUMENT_URL', type: 'text' }, { name: 'FIRSTNAME' }] })

  it('reports every person as failed when the attribute does not exist, without touching contacts', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input))
      return json({ attributes: [{ name: 'FIRSTNAME' }] })
    }
    const sync = await syncDesignationLinks({
      apiKey: 'k',
      listId: 94,
      attribute: 'DOCUMENT_URL',
      contacts: [{ personId: 'p1', email: 'a@example.com', url: 'https://drive.google.com/file/d/a/view' }],
      fetchImpl,
    })
    expect(sync.attributeMissing).toBe(true)
    expect(sync.results).toEqual([{ personId: 'p1', ok: false, error: 'В Brevo няма атрибут DOCUMENT_URL.' }])
    expect(calls).toEqual(['https://api.brevo.com/v3/contacts/attributes'])
  })

  it('updates existing contacts, creates missing ones and reports Brevo errors per person', async () => {
    const calls: Array<{ method: string; url: string; body: string }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push({ method: init?.method ?? 'GET', url, body: String(init?.body ?? '') })
      if (url.endsWith('/contacts/attributes')) return attributes.clone()
      if (init?.method === 'PUT' && url.includes('new%40example.com')) return json({ message: 'Contact does not exist', code: 'document_not_found' }, 404)
      if (init?.method === 'PUT' && url.includes('bad%40example.com')) return json({ message: 'Invalid attribute', code: 'invalid_parameter' }, 400)
      if (init?.method === 'POST') return json({ id: 1 }, 201)
      return new Response(null, { status: 204 })
    }
    const sync = await syncDesignationLinks({
      apiKey: 'k',
      listId: 94,
      attribute: 'DOCUMENT_URL',
      contacts: [
        { personId: 'p1', email: 'harry@example.com', url: 'https://drive.google.com/file/d/1/view' },
        { personId: 'p2', email: 'new@example.com', url: 'https://drive.google.com/file/d/2/view' },
        { personId: 'p3', email: 'bad@example.com', url: 'https://drive.google.com/file/d/3/view' },
      ],
      fetchImpl,
    })
    expect(sync.results).toEqual([
      { personId: 'p1', ok: true },
      { personId: 'p2', ok: true, created: true },
      { personId: 'p3', ok: false, error: 'Invalid attribute (invalid_parameter)' },
    ])
    const put = calls.find((call) => call.method === 'PUT' && call.url.includes('harry%40example.com'))
    expect(put?.url).toContain('identifierType=email_id')
    expect(JSON.parse(put?.body ?? '{}')).toEqual({ attributes: { DOCUMENT_URL: 'https://drive.google.com/file/d/1/view' }, listIds: [94] })
    const post = calls.find((call) => call.method === 'POST')
    expect(JSON.parse(post?.body ?? '{}')).toEqual({
      email: 'new@example.com',
      attributes: { DOCUMENT_URL: 'https://drive.google.com/file/d/2/view' },
      listIds: [94],
      updateEnabled: true,
    })
  })
})

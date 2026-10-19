import { describe, expect, it } from 'vitest'
import { checkDesignationLink, pushDesignationLink, readBrevoContactAttribute, syncDesignationLinks, updateBrevoContactAttribute } from './designation-brevo'

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
      if ((init?.method ?? 'GET') === 'GET') return json({ email: 'harry@example.com', attributes: { DOCUMENT_URL: 'https://drive.google.com/file/d/1/view' } })
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

describe('signed link read-back', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const contact = { personId: 'p1', email: 'harry+test@example.com', url: 'https://drive.google.com/file/d/signed/view' }

  it('reads the attribute case-insensitively from GET /contacts/{email}', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input))
      return json({ attributes: { document_url: 'x' } })
    }
    await expect(readBrevoContactAttribute('k', contact.email, 'DOCUMENT_URL', fetchImpl)).resolves.toBe('x')
    expect(urls).toEqual(['https://api.brevo.com/v3/contacts/harry%2Btest%40example.com?identifierType=email_id'])
  })

  it('flags a contact that still holds the old link after Brevo accepted the update', async () => {
    const fetchImpl: typeof fetch = async () => json({ attributes: { DOCUMENT_URL: 'https://drive.google.com/file/d/unsigned/view' } })
    const check = await checkDesignationLink({ apiKey: 'k', attribute: 'DOCUMENT_URL', contact, fetchImpl })
    expect(check).toEqual({ personId: 'p1', ok: false, error: 'Brevo прие заявката, но DOCUMENT_URL в контакта още е стария линк.' })
  })

  it('confirms the signed link when Brevo stored it', async () => {
    const fetchImpl: typeof fetch = async () => json({ attributes: { DOCUMENT_URL: contact.url } })
    await expect(checkDesignationLink({ apiKey: 'k', attribute: 'document_url', contact, fetchImpl })).resolves.toEqual({ personId: 'p1', ok: true })
  })

  it('syncDesignationLinks turns a failed read-back into a visible per-person error', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/contacts/attributes')) return json({ attributes: [{ name: 'DOCUMENT_URL', type: 'text' }] })
      if (init?.method === 'PUT') return new Response(null, { status: 204 })
      return json({ attributes: { DOCUMENT_URL: 'https://drive.google.com/file/d/unsigned/view' } })
    }
    const sync = await syncDesignationLinks({ apiKey: 'k', listId: 95, attribute: 'DOCUMENT_URL', contacts: [contact], fetchImpl })
    expect(sync.check?.ok).toBe(false)
    expect(sync.results).toEqual([{ personId: 'p1', ok: false, error: 'Brevo прие заявката, но DOCUMENT_URL в контакта още е стария линк.' }])
  })

  it('surfaces a key error from the attribute check instead of silently doing nothing', async () => {
    const fetchImpl: typeof fetch = async () => json({ message: 'Key not found', code: 'unauthorized' }, 401)
    await expect(
      syncDesignationLinks({ apiKey: 'bad', listId: 95, attribute: 'DOCUMENT_URL', contacts: [contact], fetchImpl }),
    ).rejects.toThrow('Key not found (unauthorized)')
  })
})

describe('pushDesignationLink (upload auto-sync)', () => {
  const contact = { personId: 'p1', email: 'harry+signed@example.com', url: 'https://drive.google.com/file/d/signed/view' }

  it('PUTs the signed Drive link into DOCUMENT_URL and adds the list', async () => {
    const calls: Array<{ method: string; url: string; body: string }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ method: init?.method ?? 'GET', url: String(input), body: String(init?.body ?? '') })
      return new Response(null, { status: 204 })
    }
    const result = await pushDesignationLink({ apiKey: 'k', listId: 95, attribute: 'document_url', contact, fetchImpl })
    expect(result).toEqual({ personId: 'p1', ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('PUT')
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ attributes: { DOCUMENT_URL: contact.url }, listIds: [95] })
  })

  it('creates the contact when Brevo answers 404', async () => {
    const methods: string[] = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      methods.push(init?.method ?? 'GET')
      if (init?.method === 'PUT') return new Response(JSON.stringify({ message: 'Contact does not exist' }), { status: 404 })
      return new Response(JSON.stringify({ id: 7 }), { status: 201 })
    }
    await expect(pushDesignationLink({ apiKey: 'k', listId: null, attribute: 'DOCUMENT_URL', contact, fetchImpl })).resolves.toEqual({
      personId: 'p1',
      ok: true,
      created: true,
    })
    expect(methods).toEqual(['PUT', 'POST'])
  })

  it('returns the Brevo error instead of throwing', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ message: 'Key not found', code: 'unauthorized' }), { status: 401 })
    await expect(pushDesignationLink({ apiKey: 'k', listId: 95, attribute: 'DOCUMENT_URL', contact, fetchImpl })).resolves.toEqual({
      personId: 'p1',
      ok: false,
      error: 'Key not found (unauthorized)',
    })
  })
})

import { describe, expect, it } from 'vitest'
import { designationSectionAttributes, pushDesignationLink, syncDesignationLinks } from './designation-brevo'

const account = [
  { name: 'DOCUMENT_URL', type: 'text' },
  { name: 'FIRSTNAME', type: 'text' },
  { name: 'LASTNAME', type: 'text' },
  { name: 'SMS', type: 'text' },
  { name: 'MIR', type: 'text' },
  { name: 'SECTION_ID', type: 'float' },
  { name: 'SECTION_CODE', type: 'text' },
  { name: 'SECTION_ID_TEXT', type: 'text' },
  { name: 'SECTION_ADDRESS', type: 'text' },
  { name: 'SECTION_PLACE', type: 'text' },
  { name: 'LOCATION', type: 'text' },
  { name: 'SECTION_PUBLISHED', type: 'boolean' },
  {
    name: 'ROLE',
    type: 'category',
    enumeration: [
      { value: 1, label: 'Представител' },
      { value: 2, label: 'Наблюдател' },
    ],
  },
]

const fields = {
  firstName: 'Иван',
  lastName: 'Петров',
  mir: '23',
  publishedSection: '234614001',
  sectionAddress: 'ул. Шипка 1',
  sectionPlace: 'Лозенец, София',
  role: 'section',
}

describe('designationSectionAttributes', () => {
  it('builds the section attributes the Секции sync sends, without SMS', () => {
    const attrs = designationSectionAttributes(fields, account)
    expect(attrs).toMatchObject({
      FIRSTNAME: 'Иван',
      LASTNAME: 'Петров',
      MIR: '23',
      SECTION_ADDRESS: 'ул. Шипка 1',
      SECTION_PLACE: 'Лозенец, София',
      SECTION_PUBLISHED: true,
      ROLE: 1,
    })
    expect(attrs.SECTION_ID).toBe(234614001)
    expect(String(attrs.SECTION_CODE)).toContain('234614001')
    expect(attrs).not.toHaveProperty('SMS')
    expect(attrs).not.toHaveProperty('DOCUMENT_URL')
  })

  it('fills LOCATION with the place (city and country abroad)', () => {
    expect(designationSectionAttributes(fields, account).LOCATION).toBe('Лозенец, София')
    const abroad = designationSectionAttributes(
      { ...fields, publishedSection: '320922343', mir: '32', sectionAddress: '', sectionPlace: 'Борнмът, Обединено кралство', location: 'Борнмът, Обединено кралство' },
      account,
    )
    expect(abroad.LOCATION).toBe('Борнмът, Обединено кралство')
    expect(abroad.SECTION_PLACE).toBe('Борнмът, Обединено кралство')
    expect(abroad).not.toHaveProperty('SECTION_ADDRESS')
    const withAddress = designationSectionAttributes(
      { ...fields, publishedSection: '320922343', mir: '32', sectionAddress: 'The Green House Hotel, 4 Grove Road, Bournemouth, BH1 3A', sectionPlace: 'Борнмът, Обединено кралство' },
      account,
    )
    expect(withAddress.SECTION_ADDRESS).toBe('The Green House Hotel, 4 Grove Road, Bournemouth, BH1 3A')
  })

  it('never sends a blank value over a stored one', () => {
    const attrs = designationSectionAttributes({ ...fields, sectionAddress: '  ', sectionPlace: '', firstName: '', role: '' }, account)
    expect(attrs).not.toHaveProperty('SECTION_ADDRESS')
    expect(attrs).not.toHaveProperty('SECTION_PLACE')
    expect(attrs).not.toHaveProperty('LOCATION')
    expect(attrs).not.toHaveProperty('FIRSTNAME')
    expect(attrs).not.toHaveProperty('ROLE')
    for (const value of Object.values(attrs)) {
      expect(value === '' || value === null || value === undefined).toBe(false)
    }
  })

  it('only sends attributes the Brevo account has', () => {
    const attrs = designationSectionAttributes(fields, [{ name: 'DOCUMENT_URL', type: 'text' }, { name: 'SECTION_ADDRESS', type: 'text' }])
    expect(attrs).toEqual({ SECTION_ADDRESS: 'ул. Шипка 1' })
  })

  it('skips LOCATION when it is not a text attribute in Brevo', () => {
    const typed = account.map((attr) => (attr.name === 'LOCATION' ? { name: 'LOCATION', type: 'category', enumeration: [] } : attr))
    expect(designationSectionAttributes(fields, typed)).not.toHaveProperty('LOCATION')
  })

  it('omits a ROLE label missing from the Brevo enumeration', () => {
    const attrs = designationSectionAttributes({ ...fields, role: 'unknown-role' }, account)
    expect(attrs).not.toHaveProperty('ROLE')
  })
})

describe('pushDesignationLink with section attributes', () => {
  const section = designationSectionAttributes(fields, account)
  const contact = { personId: 'p1', email: 'ivan@example.com', url: 'https://drive.example/signed', section }

  it('sends DOCUMENT_URL and the section in one PUT', async () => {
    const bodies: Array<{ method: string; body: Record<string, unknown> }> = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      bodies.push({ method: String(init?.method), body: JSON.parse(String(init?.body)) })
      return new Response(null, { status: 204 })
    }
    const result = await pushDesignationLink({ apiKey: 'k', listId: 95, attribute: 'DOCUMENT_URL', contact, fetchImpl })
    expect(result).toEqual({ personId: 'p1', ok: true })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.method).toBe('PUT')
    expect(bodies[0]?.body).toEqual({ attributes: { ...section, DOCUMENT_URL: 'https://drive.example/signed' }, listIds: [95] })
  })

  it('still stores the link when Brevo refuses the section attributes', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { attributes: Record<string, unknown> }
      bodies.push(body.attributes)
      if (Object.keys(body.attributes).length > 1) {
        return new Response(JSON.stringify({ message: 'Invalid attribute SECTION_ID' }), { status: 400, headers: { 'content-type': 'application/json' } })
      }
      return new Response(null, { status: 204 })
    }
    const result = await pushDesignationLink({ apiKey: 'k', listId: null, attribute: 'DOCUMENT_URL', contact, fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.warning).toContain('Invalid attribute SECTION_ID')
    expect(bodies.at(-1)).toEqual({ DOCUMENT_URL: 'https://drive.example/signed' })
  })

  it('creates a missing contact with the section attributes too', async () => {
    const calls: Array<{ method: string; body: { attributes: Record<string, unknown>; updateEnabled?: boolean } }> = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push({ method: String(init?.method), body: JSON.parse(String(init?.body)) })
      if (init?.method === 'PUT') return new Response(JSON.stringify({ message: 'Contact does not exist' }), { status: 404, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ id: 1 }), { status: 201, headers: { 'content-type': 'application/json' } })
    }
    const result = await pushDesignationLink({ apiKey: 'k', listId: 95, attribute: 'DOCUMENT_URL', contact, fetchImpl })
    expect(result).toEqual({ personId: 'p1', ok: true, created: true })
    expect(calls[1]?.method).toBe('POST')
    expect(calls[1]?.body.attributes).toMatchObject({ SECTION_ADDRESS: 'ул. Шипка 1', DOCUMENT_URL: 'https://drive.example/signed' })
  })

  it('syncDesignationLinks reuses the caller’s attribute list and sends the section', async () => {
    const methods: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      methods.push(`${init?.method ?? 'GET'} ${String(input).split('?')[0]}`)
      return new Response(null, { status: 204 })
    }
    const sync = await syncDesignationLinks({ apiKey: 'k', listId: 95, attribute: 'DOCUMENT_URL', contacts: [contact], fetchImpl, account, verify: false })
    expect(sync.results).toEqual([{ personId: 'p1', ok: true }])
    expect(methods.some((call) => call.endsWith('/contacts/attributes'))).toBe(false)
  })
})

describe('people without a signed пълномощно yet', () => {
  function recorder() {
    const bodies: Array<{ method: string; url: string; body: Record<string, unknown> }> = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      bodies.push({ method: String(init?.method ?? 'GET'), url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} })
      if (url.endsWith('/contacts/attributes')) return new Response(JSON.stringify({ attributes: account }), { status: 200 })
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    return { bodies, fetchImpl }
  }

  it('get their section on the contact and no DOCUMENT_URL at all (never a blank that wipes a link)', async () => {
    const { bodies, fetchImpl } = recorder()
    const section = designationSectionAttributes(fields, account)
    const result = await pushDesignationLink({
      apiKey: 'k',
      listId: 7,
      attribute: 'DOCUMENT_URL',
      contact: { personId: 's1', email: 'a@example.com', url: '', section },
      fetchImpl,
    })
    expect(result.ok).toBe(true)
    const put = bodies.find((call) => call.method === 'PUT')!
    const attributes = put.body.attributes as Record<string, unknown>
    expect(attributes).not.toHaveProperty('DOCUMENT_URL')
    expect(attributes.MIR).toBe('23')
    expect(put.body.listIds).toEqual([7])
  })

  it('are reported, not sent, when there is neither a link nor a section', async () => {
    const { bodies, fetchImpl } = recorder()
    const result = await pushDesignationLink({ apiKey: 'k', listId: null, attribute: 'DOCUMENT_URL', contact: { personId: 's1', email: 'a@example.com', url: '' }, fetchImpl })
    expect(result.ok).toBe(false)
    expect(bodies).toHaveLength(0)
  })

  it('a resync of signed and unsigned people sends the link only to the signed', async () => {
    const { bodies, fetchImpl } = recorder()
    const section = designationSectionAttributes(fields, account)
    const sync = await syncDesignationLinks({
      apiKey: 'k',
      listId: null,
      attribute: 'DOCUMENT_URL',
      account,
      verify: false,
      fetchImpl,
      contacts: [
        { personId: 'signed', email: 'signed@example.com', url: 'https://drive.example/a', section },
        { personId: 'unsigned', email: 'unsigned@example.com', url: '', section },
      ],
    })
    expect(sync.results.every((row) => row.ok)).toBe(true)
    const puts = bodies.filter((call) => call.method === 'PUT')
    const byEmail = new Map(puts.map((call) => [decodeURIComponent(call.url.split('/contacts/')[1]!.split('?')[0]!), call.body.attributes as Record<string, unknown>]))
    expect(byEmail.get('signed@example.com')?.DOCUMENT_URL).toBe('https://drive.example/a')
    expect(byEmail.get('unsigned@example.com')).not.toHaveProperty('DOCUMENT_URL')
  })
})

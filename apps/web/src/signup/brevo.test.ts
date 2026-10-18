import { describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({ env: {} }))

import { BrevoApiError, brevoFetch, fetchBrevoHealth, importContactsToList, type BrevoConfig } from './brevo'

const config: BrevoConfig = {
  apiKey: 'test-key',
  listId: 42,
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

describe('brevoFetch', () => {
  it('throws BrevoApiError with status and mapped IP message', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { message: 'unrecognised IP address 198.51.100.9', code: 'unauthorized' }),
    )
    await expect(brevoFetch('key', '/account', { method: 'GET' }, fetchImpl)).rejects.toMatchObject({
      name: 'BrevoApiError',
      status: 401,
      message: expect.stringContaining('198.51.100.9'),
    })
    await expect(brevoFetch('key', '/account', { method: 'GET' }, fetchImpl)).rejects.toBeInstanceOf(BrevoApiError)
  })
})

describe('importContactsToList', () => {
  it('posts disableNotification and emptyContactsAttributes false', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { processId: 7 }))
    await importContactsToList(
      config,
      [{ email: 'a@example.com', attributes: { FIRSTNAME: 'А', SECTION_PUBLISHED: true } }],
      42,
      fetchImpl,
    )
    expect(fetchImpl).toHaveBeenCalledOnce()
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(call[1].body)) as {
      disableNotification: boolean
      emptyContactsAttributes: boolean
      updateExistingContacts: boolean
      listIds: number[]
    }
    expect(body.disableNotification).toBe(true)
    expect(body.emptyContactsAttributes).toBe(false)
    expect(body.updateExistingContacts).toBe(true)
    expect(body.listIds).toEqual([42])
  })
})

describe('fetchBrevoHealth', () => {
  it('keeps independent checks when one endpoint fails', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/account')) {
        return jsonResponse(200, {
          companyName: 'ДаБг',
          email: 'team@tibroish.bg',
          plan: [{ type: 'free', credits: 10 }],
        })
      }
      if (url.includes('/contacts/lists/')) return jsonResponse(404, { message: 'List not found' })
      if (url.endsWith('/contacts/attributes')) {
        return jsonResponse(200, {
          attributes: [
            { name: 'SECTION_ID', type: 'float' },
            { name: 'SECTION_CODE', type: 'text' },
            { name: 'SECTION_ID_TEXT', type: 'text' },
            { name: 'MIR', type: 'text' },
            {
              name: 'ROLE',
              type: 'category',
              enumeration: [
                { value: 1, label: 'Наблюдател' },
                { value: 2, label: 'Представител' },
              ],
            },
            { name: 'FIRSTNAME', type: 'text' },
            { name: 'LASTNAME', type: 'text' },
            { name: 'SMS', type: 'text' },
            { name: 'SECTION_ADDRESS', type: 'text' },
            { name: 'SECTION_PLACE', type: 'text' },
            { name: 'SECTION_PUBLISHED', type: 'boolean' },
            { name: 'PALNOMOSHTNO_URL', type: 'text' },
          ],
        })
      }
      if (url.endsWith('/senders')) {
        return jsonResponse(200, { senders: [{ email: 'team@tibroish.bg', active: true, verified: true }] })
      }
      return jsonResponse(500, { message: 'nope' })
    })
    const health = await fetchBrevoHealth(config, fetchImpl)
    expect(health.account.ok).toBe(true)
    expect(health.list.ok).toBe(false)
    expect(health.list.error).toContain('404')
    expect(health.attributes.ok).toBe(true)
    expect(health.sender.ok).toBe(true)
  })
})

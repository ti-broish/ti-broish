import { describe, expect, it } from 'vitest'
import { updateBrevoContactAttribute } from './designation-brevo'

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
    await updateBrevoContactAttribute('secret-key', 'ivan@example.com', { PALNOMOSHTNO_URL: 'https://drive.example/file' }, fetchImpl)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.brevo.com/v3/contacts/ivan%40example.com?identifierType=emailId')
    expect(calls[0]?.body).toBe(JSON.stringify({ attributes: { PALNOMOSHTNO_URL: 'https://drive.example/file' } }))
    expect(calls[0]?.apiKey).toBe('secret-key')
  })

  it('surfaces a Brevo error message', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: 'contact not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
    await expect(updateBrevoContactAttribute('k', 'missing@example.com', { PALNOMOSHTNO_URL: 'x' }, fetchImpl)).rejects.toThrow('contact not found')
  })
})

import { describe, expect, it } from 'vitest'
import { createDriveClient, parseServiceAccount, withRetry } from './designation-drive'

describe('designation Drive client', () => {
  it('parses a service-account JSON object', () => {
    const parsed = parseServiceAccount(
      JSON.stringify({
        client_email: 'sa@example.com',
        private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
      }),
    )
    expect(parsed.client_email).toBe('sa@example.com')
    expect(parsed.private_key).toContain('BEGIN PRIVATE KEY')
    expect(() => parseServiceAccount('{')).toThrow(/валиден JSON/)
  })

  it('uploads a PDF, shares it with anyone with the link, and returns the view URL', async () => {
    const calls: Array<{ url: string; method: string; body: string }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      const body = typeof init?.body === 'string' ? init.body : init?.body instanceof Uint8Array ? 'bytes' : ''
      calls.push({ url, method, body })
      if (url.includes('oauth2.googleapis.com/token')) {
        return json({ access_token: 'tok' })
      }
      if (url.includes('/upload/drive/v3/files') && method === 'POST') {
        return json({ id: 'file-1', webViewLink: '' })
      }
      if (url.includes('/permissions')) {
        return json({ id: 'perm-1' })
      }
      if (url.includes('/drive/v3/files/file-1') && method === 'GET') {
        return json({ id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' })
      }
      return json({ error: url }, 500)
    }
    const client = createDriveClient(
      { kind: 'oauth', clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
      fetchImpl,
    )
    const file = await client.uploadPdf({ name: 'Пълномощно 1 – Иван.pdf', bytes: new Uint8Array([1, 2, 3]), folderId: 'folder-1' })
    expect(file).toEqual({ id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' })
    expect(calls.some((call) => call.url.includes('supportsAllDrives=true') && call.method === 'POST')).toBe(true)
    expect(calls.some((call) => call.url.includes('/permissions') && call.body.includes('"type":"anyone"'))).toBe(true)
    expect(calls.every((call) => !call.body.includes('refresh') && !call.url.includes('secret'))).toBe(true)
  })

  it('updates an existing file in place', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'tok' })
      if (url.includes('/upload/drive/v3/files/file-9') && method === 'PATCH') return json({})
      if (url.includes('/drive/v3/files/file-9')) return json({ id: 'file-9', webViewLink: 'https://drive.google.com/file/d/file-9/view' })
      return json({ error: url }, 500)
    }
    const client = createDriveClient(
      { kind: 'oauth', clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
      fetchImpl,
    )
    const file = await client.uploadPdf({
      name: 'Пълномощно 1 – Иван.pdf',
      bytes: new Uint8Array([9]),
      folderId: 'folder-1',
      fileId: 'file-9',
    })
    expect(file.id).toBe('file-9')
  })

  it('retries 429 then succeeds', async () => {
    let n = 0
    const result = await withRetry(async () => {
      n += 1
      return { ok: n > 1, status: n > 1 ? 200 : 429 }
    }, 3)
    expect(result.ok).toBe(true)
    expect(n).toBe(2)
  })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

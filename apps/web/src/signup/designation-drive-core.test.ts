import { describe, expect, it } from 'vitest'
import {
  base64UrlDecode,
  createDriveClient,
  designationHealthMessage,
  pemToPkcs8,
  probeDesignationDriveHealth,
  signJwtRs256,
  tryReadDriveAuth,
} from './designation-drive-core'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('Drive auth health without credentials', () => {
  it('lists the exact missing secret names and does not throw', async () => {
    const auth = tryReadDriveAuth({})
    expect(auth.ok).toBe(false)
    if (auth.ok) throw new Error('expected missing')
    expect(auth.missing).toEqual([
      'GOOGLE_SERVICE_ACCOUNT_JSON',
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'GOOGLE_OAUTH_REFRESH_TOKEN',
    ])
    const health = await probeDesignationDriveHealth({})
    expect(health.credentialKind).toBe('none')
    expect(health.tokenOk).toBe(false)
    expect(health.folderOk).toBe(false)
    expect(health.missingSecrets).toContain('GOOGLE_SERVICE_ACCOUNT_JSON')
    expect(health.folderError).toMatch(/DESIGNATION_DRIVE_FOLDER_ID/)
    expect(health.brevoKey).toBe(false)
    expect(health.brevoAttribute).toBe('PALNOMOSHTNO_URL')
    expect(designationHealthMessage(health)).toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON/)
    expect(designationHealthMessage(health)).toMatch(/Качването към Drive е изключено/)
  })
})

describe('WebCrypto JWT RS256', () => {
  it('signs a JWT with a generated PKCS8 key and verifies it', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
    let binary = ''
    for (const byte of pkcs8) binary += String.fromCharCode(byte)
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----\n`
    expect(pemToPkcs8(pem).length).toBe(pkcs8.length)
    const jwt = await signJwtRs256({ iss: 'sa@example.com', sub: 'test', exp: 1 }, pem)
    const parts = jwt.split('.')
    expect(parts).toHaveLength(3)
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    const sig = base64UrlDecode(parts[2]!)
    const sigBuf = new ArrayBuffer(sig.byteLength)
    new Uint8Array(sigBuf).set(sig)
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, sigBuf, data)
    expect(ok).toBe(true)
  })
})

describe('Drive replace path', () => {
  it('updates in place, and on 404 creates a new file with anyone-reader', async () => {
    const calls: Array<{ url: string; method: string }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({ url, method })
      if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'tok', expires_in: 3600 })
      if (url.includes('/upload/drive/v3/files/gone') && method === 'PATCH') return json({ error: 'not found' }, 404)
      if (url.includes('/upload/drive/v3/files') && method === 'POST') {
        return json({ id: 'new-1', webViewLink: 'https://drive.google.com/file/d/new-1/view' })
      }
      if (url.includes('/permissions')) return json({ id: 'perm' })
      return json({ error: url }, 500)
    }
    const client = createDriveClient(
      { kind: 'oauth', clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
      fetchImpl,
    )
    const file = await client.uploadPdf({
      name: '0001_234600101_Petrova_signed.pdf',
      bytes: new Uint8Array([1, 2, 3]),
      folderId: 'folder-1',
      fileId: 'gone',
    })
    expect(file.id).toBe('new-1')
    expect(calls.some((call) => call.method === 'PATCH' && call.url.includes('/files/gone'))).toBe(true)
    expect(calls.some((call) => call.method === 'POST' && call.url.includes('uploadType=multipart'))).toBe(true)
    expect(calls.some((call) => call.url.includes('/permissions'))).toBe(true)
  })
})

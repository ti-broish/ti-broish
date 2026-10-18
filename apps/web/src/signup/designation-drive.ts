import { createPrivateKey, createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const FILES_URL = 'https://www.googleapis.com/drive/v3/files'

export type DriveAuth =
  | { kind: 'service-account'; json: string; scope: string }
  | { kind: 'oauth'; clientId: string; clientSecret: string; refreshToken: string }

export interface DriveFile {
  id: string
  webViewLink: string
}

export interface DriveClient {
  uploadPdf(input: { name: string; bytes: Uint8Array; folderId: string; fileId?: string }): Promise<DriveFile>
}

interface ServiceAccount {
  client_email?: string
  private_key?: string
  token_uri?: string
}

export function readDriveAuth(env: Record<string, string | undefined>): DriveAuth {
  const oauthId = (env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim()
  const oauthSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim()
  const refresh = (env.GOOGLE_OAUTH_REFRESH_TOKEN ?? '').trim()
  if (oauthId && oauthSecret && refresh) {
    return { kind: 'oauth', clientId: oauthId, clientSecret: oauthSecret, refreshToken: refresh }
  }
  const raw = (env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '').trim()
  if (!raw) throw new Error('Липсва GOOGLE_SERVICE_ACCOUNT_JSON или OAuth тройката.')
  const scope = (env.GOOGLE_DRIVE_SCOPE ?? '').trim() || DRIVE_FILE_SCOPE
  return { kind: 'service-account', json: raw, scope }
}

export function createDriveClient(auth: DriveAuth, fetchImpl: typeof fetch = fetch): DriveClient {
  return {
    async uploadPdf(input) {
      const token = await accessToken(auth, fetchImpl)
      if (input.fileId) return updatePdf(token, input.fileId, input.bytes, fetchImpl)
      return createPdf(token, input, fetchImpl)
    },
  }
}

async function createPdf(
  token: string,
  input: { name: string; bytes: Uint8Array; folderId: string },
  fetchImpl: typeof fetch,
): Promise<DriveFile> {
  const boundary = `designation_${crypto.randomUUID()}`
  const metadata = JSON.stringify({
    name: input.name,
    parents: [input.folderId],
    mimeType: 'application/pdf',
  })
  const body = bytesToBody(multipartBody(boundary, metadata, input.bytes))
  const uploaded = await driveFetch(
    fetchImpl,
    `${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )
  const file = parseFile(uploaded)
  await driveFetch(fetchImpl, `${FILES_URL}/${encodeURIComponent(file.id)}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
  })
  if (file.webViewLink) return file
  const listed = await driveFetch(
    fetchImpl,
    `${FILES_URL}/${encodeURIComponent(file.id)}?fields=id,webViewLink&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return parseFile(listed)
}

async function updatePdf(token: string, fileId: string, bytes: Uint8Array, fetchImpl: typeof fetch): Promise<DriveFile> {
  await driveFetch(
    fetchImpl,
    `${UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/pdf',
      },
      body: bytesToBody(bytes),
    },
  )
  const listed = await driveFetch(
    fetchImpl,
    `${FILES_URL}/${encodeURIComponent(fileId)}?fields=id,webViewLink&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return parseFile(listed)
}

function multipartBody(boundary: string, metadata: string, bytes: Uint8Array) {
  const encoder = new TextEncoder()
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
  )
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + bytes.length + tail.length)
  body.set(head, 0)
  body.set(bytes, head.length)
  body.set(tail, head.length + bytes.length)
  return body
}

function bytesToBody(bytes: Uint8Array): BodyInit {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function parseFile(json: unknown): DriveFile {
  if (!json || typeof json !== 'object') throw new Error('Drive не върна файл.')
  const id = 'id' in json ? String(json.id ?? '') : ''
  const webViewLink = 'webViewLink' in json ? String(json.webViewLink ?? '') : ''
  if (!id) throw new Error('Drive не върна идентификатор на файла.')
  return { id, webViewLink }
}

async function accessToken(auth: DriveAuth, fetchImpl: typeof fetch) {
  if (auth.kind === 'oauth') {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      refresh_token: auth.refreshToken,
    })
    const json = await tokenFetch(fetchImpl, body)
    return json.access_token
  }
  const account = parseServiceAccount(auth.json)
  const now = Math.floor(Date.now() / 1000)
  const jwt = signJwt(
    {
      iss: account.client_email,
      scope: auth.scope,
      aud: account.token_uri ?? TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
  )
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  })
  const json = await tokenFetch(fetchImpl, body)
  return json.access_token
}

async function tokenFetch(fetchImpl: typeof fetch, body: URLSearchParams) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await response.json()) as { access_token?: string; error?: string }
  if (!response.ok || !json.access_token) throw new Error('Google OAuth не върна токен.')
  return { access_token: json.access_token }
}

export function parseServiceAccount(raw: string): { client_email: string; private_key: string; token_uri?: string } {
  const text = looksLikePath(raw) ? readJsonFile(raw) : raw
  let parsed: ServiceAccount
  try {
    parsed = JSON.parse(text) as ServiceAccount
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON не е валиден JSON.')
  }
  const email = parsed.client_email?.trim() ?? ''
  const key = parsed.private_key?.replace(/\\n/g, '\n') ?? ''
  if (!email || !key) throw new Error('В служебния акаунт липсват client_email или private_key.')
  return { client_email: email, private_key: key, token_uri: parsed.token_uri }
}

function looksLikePath(raw: string) {
  return (raw.endsWith('.json') || raw.startsWith('/') || raw.startsWith('./')) && !raw.trim().startsWith('{')
}

function readJsonFile(path: string) {
  return readFileSync(path, 'utf8')
}

function signJwt(payload: Record<string, unknown>, privateKey: string) {
  const header = { alg: 'RS256', typ: 'JWT' }
  const encoded = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const sign = createSign('RSA-SHA256')
  sign.update(encoded)
  const signature = sign.sign(createPrivateKey(privateKey), 'base64url')
  return `${encoded}.${signature}`
}

function b64url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

async function driveFetch(fetchImpl: typeof fetch, url: string, init: RequestInit) {
  const response = await withRetry(() => fetchImpl(url, init))
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!response.ok) throw new Error(`Drive HTTP ${response.status}`)
  return json
}

export async function withRetry<T extends { ok: boolean; status: number }>(
  run: () => Promise<T>,
  attempts = 4,
) {
  let last: T | undefined
  for (let i = 0; i < attempts; i++) {
    last = await run()
    if (last.ok || (last.status < 500 && last.status !== 429)) return last
    await sleep(400 * 2 ** i)
  }
  return last as T
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

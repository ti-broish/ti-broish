import { DEFAULT_BREVO_DESIGNATION_ATTRIBUTE } from './designation-config'

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

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

export interface DriveAdminClient extends DriveClient {
  statFile(id: string): Promise<{ id: string; name: string; mimeType: string; driveId: string }>
  /** Bytes of a file the app can read (the signed PDFs it uploaded). */
  downloadFile(id: string): Promise<Uint8Array>
}

export class DriveHttpError extends Error {
  readonly status: number
  /** Google's short reason (`rateLimitExceeded`, `notFound`, …) when the body had one. */
  readonly reason: string

  constructor(status: number, reason = '') {
    super(reason ? `Drive HTTP ${status}: ${reason}` : `Drive HTTP ${status}`)
    this.name = 'DriveHttpError'
    this.status = status
    this.reason = reason
  }
}

/** `{ error: { errors: [{ reason }], message } }` → a short reason; never the whole body. */
export function driveErrorReason(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const error = (json as { error?: unknown }).error
  if (!error || typeof error !== 'object') return typeof error === 'string' ? error.slice(0, 120) : ''
  const bag = error as { errors?: Array<{ reason?: unknown }>; message?: unknown; status?: unknown }
  const reason = bag.errors?.find((item) => typeof item?.reason === 'string')?.reason
  if (typeof reason === 'string' && reason) return reason.slice(0, 120)
  if (typeof bag.message === 'string' && bag.message) return bag.message.slice(0, 120)
  return typeof bag.status === 'string' ? bag.status.slice(0, 120) : ''
}

interface ServiceAccount {
  client_email?: string
  private_key?: string
  token_uri?: string
}

export function designationDriveFolderId(env: Record<string, string | undefined>) {
  const dedicated = (env.DESIGNATION_DRIVE_FOLDER_ID ?? '').trim()
  if (dedicated) return dedicated
  return (env.DRIVE_FOLDER_ID ?? '').trim()
}

export function designationDriveFolderSource(env: Record<string, string | undefined>) {
  if ((env.DESIGNATION_DRIVE_FOLDER_ID ?? '').trim()) return 'DESIGNATION_DRIVE_FOLDER_ID' as const
  if ((env.DRIVE_FOLDER_ID ?? '').trim()) return 'DRIVE_FOLDER_ID' as const
  return 'none' as const
}

export function tryReadDriveAuth(env: Record<string, string | undefined>): { ok: true; auth: DriveAuth } | { ok: false; missing: string[] } {
  const oauthId = (env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim()
  const oauthSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim()
  const refresh = (env.GOOGLE_OAUTH_REFRESH_TOKEN ?? '').trim()
  if (oauthId && oauthSecret && refresh) {
    return { ok: true, auth: { kind: 'oauth', clientId: oauthId, clientSecret: oauthSecret, refreshToken: refresh } }
  }
  const raw = (env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '').trim()
  if (raw) {
    const scope = (env.GOOGLE_DRIVE_SCOPE ?? '').trim() || DRIVE_SCOPE
    return { ok: true, auth: { kind: 'service-account', json: raw, scope } }
  }
  const missing: string[] = []
  if (!raw) missing.push('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!oauthId) missing.push('GOOGLE_OAUTH_CLIENT_ID')
  if (!oauthSecret) missing.push('GOOGLE_OAUTH_CLIENT_SECRET')
  if (!refresh) missing.push('GOOGLE_OAUTH_REFRESH_TOKEN')
  return { ok: false, missing }
}

export function readDriveAuth(env: Record<string, string | undefined>): DriveAuth {
  const result = tryReadDriveAuth(env)
  if (!result.ok) throw new Error('Липсва GOOGLE_SERVICE_ACCOUNT_JSON или OAuth тройката.')
  return result.auth
}

export function parseServiceAccountJson(raw: string): { client_email: string; private_key: string; token_uri?: string } {
  let parsed: ServiceAccount
  try {
    parsed = JSON.parse(raw) as ServiceAccount
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON не е валиден JSON.')
  }
  const email = parsed.client_email?.trim() ?? ''
  const key = parsed.private_key?.replace(/\\n/g, '\n') ?? ''
  if (!email || !key) throw new Error('В служебния акаунт липсват client_email или private_key.')
  return { client_email: email, private_key: key, token_uri: parsed.token_uri }
}

export function createDriveClient(auth: DriveAuth, fetchImpl: typeof fetch = fetch): DriveAdminClient {
  let cached: { token: string; expMs: number } | null = null
  // Parallel downloads share one token fetch (the client lives for one request).
  let pending: Promise<string> | null = null

  async function token() {
    const now = Date.now()
    if (cached && now < cached.expMs) return cached.token
    pending ??= fetchAccessToken(auth, fetchImpl)
      .then((got) => {
        const ttlMs = Math.max(30, (got.expiresIn ?? 3600) - 60) * 1000
        cached = { token: got.accessToken, expMs: now + ttlMs }
        return cached.token
      })
      .finally(() => {
        pending = null
      })
    return pending
  }

  return {
    async uploadPdf(input) {
      const access = await token()
      if (input.fileId) {
        try {
          return await updatePdf(access, input.fileId, input.bytes, fetchImpl)
        } catch (error) {
          if (error instanceof DriveHttpError && (error.status === 403 || error.status === 404)) {
            return createPdf(access, input, fetchImpl)
          }
          throw error
        }
      }
      return createPdf(access, input, fetchImpl)
    },
    async downloadFile(id) {
      const access = await token()
      const response = await withRetry(() =>
        fetchImpl(`${FILES_URL}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${access}` },
        }),
      )
      if (!response.ok) throw new DriveHttpError(response.status)
      return new Uint8Array(await response.arrayBuffer())
    },
    async statFile(id) {
      const access = await token()
      const json = await driveFetch(
        fetchImpl,
        `${FILES_URL}/${encodeURIComponent(id)}?fields=id,name,mimeType,driveId&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${access}` } },
      )
      if (!json || typeof json !== 'object') throw new Error('Drive не върна файл.')
      const bag = json as { id?: unknown; name?: unknown; mimeType?: unknown; driveId?: unknown }
      const fileId = String(bag.id ?? '')
      if (!fileId) throw new Error('Drive не върна идентификатор на файла.')
      return {
        id: fileId,
        name: String(bag.name ?? ''),
        mimeType: String(bag.mimeType ?? ''),
        driveId: String(bag.driveId ?? ''),
      }
    },
  }
}

export interface DesignationDriveHealth {
  credentialKind: 'oauth' | 'service-account' | 'none'
  missingSecrets: string[]
  folderId: string
  folderIdSource: 'DESIGNATION_DRIVE_FOLDER_ID' | 'DRIVE_FOLDER_ID' | 'none'
  tokenOk: boolean
  folderOk: boolean
  folderName: string
  folderIsFolder: boolean
  folderError: string
  brevoKey: boolean
  brevoAttribute: string
  brevoListId: number | null
}

export async function probeDesignationDriveHealth(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<DesignationDriveHealth> {
  const auth = tryReadDriveAuth(env)
  const folderId = designationDriveFolderId(env)
  const folderIdSource = designationDriveFolderSource(env)
  const brevoKey = Boolean((env.BREVO_API_KEY ?? '').trim())
  const brevoAttribute = (env.BREVO_DESIGNATION_ATTRIBUTE ?? '').trim() || DEFAULT_BREVO_DESIGNATION_ATTRIBUTE
  const listRaw = (env.BREVO_LIST_ID ?? '').trim()
  const brevoListId = /^\d+$/.test(listRaw) ? Number(listRaw) : null
  const health: DesignationDriveHealth = {
    credentialKind: auth.ok ? auth.auth.kind : 'none',
    missingSecrets: auth.ok ? [] : auth.missing,
    folderId,
    folderIdSource,
    tokenOk: false,
    folderOk: false,
    folderName: '',
    folderIsFolder: false,
    folderError: '',
    brevoKey,
    brevoAttribute,
    brevoListId,
  }
  if (!folderId) {
    health.folderError = 'Липсва DESIGNATION_DRIVE_FOLDER_ID (или DRIVE_FOLDER_ID).'
  }
  if (!auth.ok) return health
  try {
    await fetchAccessToken(auth.auth, fetchImpl)
    health.tokenOk = true
  } catch (error) {
    health.folderError = error instanceof Error ? error.message : 'Токенът не се получи.'
    return health
  }
  if (!folderId) return health
  try {
    const client = createDriveClient(auth.auth, fetchImpl)
    const stat = await client.statFile(folderId)
    health.folderOk = true
    health.folderName = stat.name
    health.folderIsFolder = stat.mimeType === FOLDER_MIME
    if (!health.folderIsFolder) health.folderError = 'Идентификаторът не сочи към папка.'
  } catch (error) {
    health.folderError = error instanceof Error ? error.message : 'Drive проверката се провали.'
  }
  return health
}

export function designationHealthMessage(health: DesignationDriveHealth) {
  if (health.credentialKind === 'none') {
    const names = health.missingSecrets.join(', ')
    const folder = health.folderId ? '' : ' Липсва DESIGNATION_DRIVE_FOLDER_ID (или DRIVE_FOLDER_ID).'
    return `Липсват ${names}.${folder} Качването към Drive е изключено.`
  }
  const kind = health.credentialKind === 'oauth' ? 'OAuth' : 'служебен акаунт'
  const token = health.tokenOk ? 'токенът е получен' : 'токенът не се получи'
  const folder = health.folderOk
    ? health.folderIsFolder
      ? `папка „${health.folderName || health.folderId}“ е достъпна`
      : `ид. ${health.folderId} не е папка`
    : health.folderError || 'папката не е проверена'
  const brevo = health.brevoKey
    ? `Brevo: ${health.brevoAttribute}${health.brevoListId ? `, списък ${health.brevoListId}` : ', без списък'}`
    : 'Brevo: липсва BREVO_API_KEY'
  return `Услуга: ${kind}; ${token}; ${folder}. ${brevo}.`
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
  await driveFetch(fetchImpl, `${UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/pdf',
    },
    body: bytesToBody(bytes),
  })
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

export async function fetchAccessToken(auth: DriveAuth, fetchImpl: typeof fetch = fetch) {
  if (auth.kind === 'oauth') {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      refresh_token: auth.refreshToken,
    })
    const json = await tokenFetch(fetchImpl, body)
    return json
  }
  const account = parseServiceAccountJson(auth.json)
  const now = Math.floor(Date.now() / 1000)
  const jwt = await signJwtRs256(
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
  return tokenFetch(fetchImpl, body)
}

async function tokenFetch(fetchImpl: typeof fetch, body: URLSearchParams) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await response.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!response.ok || !json.access_token) throw new Error('Google OAuth не върна токен.')
  return { accessToken: json.access_token, expiresIn: json.expires_in }
}

export function pemToPkcs8(pem: string): Uint8Array {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function signJwtRs256(payload: Record<string, unknown>, pemPrivateKey: string) {
  const header = { alg: 'RS256', typ: 'JWT' }
  const signingInput = `${base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)))}.${base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    copyArrayBuffer(pemToPkcs8(pemPrivateKey)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
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
  if (!response.ok) throw new DriveHttpError(response.status, driveErrorReason(json))
  return json
}

export async function withRetry<T extends { ok: boolean; status: number }>(run: () => Promise<T>, attempts = 4) {
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

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

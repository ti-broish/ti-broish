// Protocols go to the Ти Броиш API, the same way the old results site sent them,
// so they reach the validation queue and the results:
// POST /pictures for each photo (data URL), POST /protocols { pictures: [ids] },
// then, only if an email was given, PATCH /protocols/:id/contact { email, secret }.
// The browser calls the API directly (CORS allows any origin). The API base is per host (api-base.ts).
import { tiBroishApi } from './api-base'
import { validEmail } from './model'
import type { PhotoInput } from './reports-validate'
import { apiErrorMessage } from './violation-api'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export const PROTOCOL_PHOTOS_MIN = 4
export const PROTOCOL_PHOTOS_MAX = 12
/** Base64 characters per photo; the browser keeps photos under ~700 KB (photos.ts PROTOCOL_PHOTO). */
const MAX_PHOTO_CHARS = 1_000_000

export interface ProtocolSendOptions {
  fetch?: Fetch
  /** reCAPTCHA v3 token per request. The API ignores it while reCAPTCHA is off. */
  recaptcha?: (action: string) => Promise<string>
  api?: string
}

export type ProtocolSendResult =
  | { ok: true; id: string; secret: string; pictureCount: number; contactSaved: boolean | null }
  | { ok: false; message: string }

export function checkProtocol(email: string, photos: PhotoInput[]): string | null {
  if (photos.length < PROTOCOL_PHOTOS_MIN) return `Качи поне ${PROTOCOL_PHOTOS_MIN} снимки, за да се вижда целият протокол.`
  if (photos.length > PROTOCOL_PHOTOS_MAX) return `Най-много ${PROTOCOL_PHOTOS_MAX} снимки.`
  for (const photo of photos) {
    if (photo.contentType !== 'image/jpeg' || photo.data.length < 32 || photo.data.length > MAX_PHOTO_CHARS) {
      return 'Снимката е твърде голяма или не се чете. Махни я и я добави пак.'
    }
  }
  if (email.trim() && !validEmail(email.trim())) return 'Имейлът не е валиден.'
  return null
}

async function call(fetcher: Fetch, api: string, method: string, path: string, body: unknown, recaptchaToken: string) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': 'bg-BG',
    'Content-Type': 'application/json',
  }
  if (recaptchaToken) headers['x-recaptcha-token'] = recaptchaToken
  let response: Response
  try {
    response = await fetcher(`${api}/${path}`, { method, headers, body: JSON.stringify(body) })
  } catch {
    return { status: 0, data: null as unknown }
  }
  const data = (await response.json().catch(() => null)) as unknown
  return { status: response.status, data }
}

const ok = (status: number) => status >= 200 && status < 300

export async function sendProtocol(email: string, photos: PhotoInput[], options: ProtocolSendOptions = {}): Promise<ProtocolSendResult> {
  const invalid = checkProtocol(email, photos)
  if (invalid) return { ok: false, message: invalid }
  const fetcher: Fetch = options.fetch ?? ((input, init) => fetch(input, init))
  const api = options.api ?? tiBroishApi()
  const token = async (action: string) => (options.recaptcha ? await options.recaptcha(action).catch(() => '') : '')

  const pictureIds: string[] = []
  for (const photo of photos) {
    const result = await call(fetcher, api, 'POST', 'pictures', { image: `data:image/jpeg;base64,${photo.data}` }, await token('sendProtocolImage'))
    const picture = result.data as { id?: unknown } | null
    if (!ok(result.status) || typeof picture?.id !== 'string') {
      return { ok: false, message: `Снимките не се качиха. ${apiErrorMessage(result.status, result.data, 'Протоколът')}` }
    }
    pictureIds.push(picture.id)
  }

  const created = await call(fetcher, api, 'POST', 'protocols', { pictures: pictureIds }, await token('sendProtocol'))
  const protocol = created.data as { id?: unknown; secret?: unknown } | null
  if (!ok(created.status) || typeof protocol?.id !== 'string') {
    return { ok: false, message: apiErrorMessage(created.status, created.data, 'Протоколът') }
  }
  const id = protocol.id
  const secret = typeof protocol.secret === 'string' ? protocol.secret : ''

  let contactSaved: boolean | null = null
  const contact = email.trim()
  if (contact && secret) {
    const result = await call(
      fetcher,
      api,
      'PATCH',
      `protocols/${encodeURIComponent(id)}/contact`,
      { email: contact, secret },
      await token('sendProtocolEmail'),
    )
    contactSaved = ok(result.status)
  }
  return { ok: true, id, secret, pictureCount: pictureIds.length, contactSaved }
}

export interface ApiProtocol {
  id: string
  status: string
  createdAt: string
  sectionId: string
  pictures: string[]
}

/** The sender's own view of a protocol, with the secret the API returned on create. */
export async function fetchOwnProtocol(
  id: string,
  secret: string,
  fetcher: Fetch = (input, init) => fetch(input, init),
  api = tiBroishApi(),
): Promise<ApiProtocol | null> {
  if (!id || !secret) return null
  try {
    const response = await fetcher(`${api}/protocols/${encodeURIComponent(id)}?secret=${encodeURIComponent(secret)}`, {
      headers: { Accept: 'application/json', 'Accept-Language': 'bg-BG' },
    })
    if (!response.ok) return null
    const data = (await response.json()) as {
      id?: string
      status?: string
      createdAt?: string
      section?: { id?: string } | null
      pictures?: { url?: string }[]
    }
    if (typeof data.id !== 'string') return null
    return {
      id: data.id,
      status: data.status ?? '',
      createdAt: data.createdAt ?? '',
      sectionId: data.section?.id ?? '',
      pictures: (data.pictures ?? []).map((picture) => picture.url ?? '').filter(Boolean),
    }
  } catch {
    return null
  }
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Получен',
  settled: 'Обработва се',
  ready: 'Обработва се',
  replaced: 'Обработен',
  approved: 'Приет',
  published: 'Приет',
  rejected: 'Отхвърлен',
}

export function protocolStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? 'Получен'
}

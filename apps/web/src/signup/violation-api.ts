// Signals go to the Ти Броиш API, the same way the old public form did,
// so they show up for the team in upravitel.tibroish.bg/violations:
// POST /pictures with each image as a data URL, then POST /violations with the picture ids.
// The browser calls the API directly (CORS allows tibroish.bg), so the API sees the sender's IP.
import type { ViolationPayload } from './reports-validate'
import type { StoredPhoto } from './reports-validate'
import { tibroishApi } from './api-base'
import { describedSignal } from './place-line'

/** api.tibroish.bg in production, d1tapi.tibroish.bg on staging (src/signup/api-base.ts). */
export function violationsApi() {
  return tibroishApi()
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface SentPicture {
  id: string
  url: string
}

export type SendResult =
  | { ok: true; id: string; secret: string; pictures: SentPicture[] }
  | { ok: false; message: string }

/** The API checks phones with libphonenumber and no default region, so local numbers need +359. */
export function apiPhone(input: string) {
  const value = input.trim().replace(/[\s()-]/g, '')
  if (/^0[1-9][0-9]{8}$/.test(value)) return value.replace(/^0/, '+359')
  if (/^0{0,2}359[1-9][0-9]{8}$/.test(value)) return value.replace(/^0{0,2}359/, '+359')
  return value
}

export interface ViolationBody {
  town: number
  section?: string
  description: string
  name: string
  email: string
  phone: string
  type: 'standard'
  pictures?: string[]
}

export function violationBody(payload: ViolationPayload, pictureIds: string[]): ViolationBody {
  const body: ViolationBody = {
    town: Number(payload.place.townId),
    description: describedSignal(payload.place, payload.description),
    name: payload.name,
    email: payload.email,
    phone: apiPhone(payload.phone),
    type: 'standard',
  }
  if (payload.place.sectionId) body.section = payload.place.sectionId
  if (pictureIds.length > 0) body.pictures = pictureIds
  return body
}

const FIELD_MESSAGES: [RegExp, string][] = [
  [/recaptcha/i, 'Проверката срещу ботове не мина. Презареди страницата и опитай пак.'],
  [/^errors\.section\b/, 'Секцията не е намерена. Избери я пак от списъка или я остави празна.'],
  [/^errors\.town\b/, 'Населеното място не е намерено. Избери го пак от списъка.'],
  [/^errors\.description\b/, 'Описанието трябва да е между 20 и 2000 знака.'],
  [/^errors\.name\b/, 'Напиши име.'],
  [/^errors\.email\b/, 'Напиши валиден имейл.'],
  [/^errors\.phone\b|телефон/i, 'Телефонният номер е невалиден. Напиши го като 0888123456 или +359888123456.'],
  [/^errors\.pictures\b/, 'Снимките не се приеха. Махни ги и ги добави пак.'],
  [/^errors\.image\b/, 'Снимката не се чете. Опитай с друга.'],
]

/** Bulgarian text for an API error body ({ message: string | string[] }). */
export function apiErrorMessage(status: number, body: unknown, subject = 'Сигналът'): string {
  const raw = (body as { message?: unknown } | null)?.message
  const messages = (Array.isArray(raw) ? raw : [raw]).filter((item): item is string => typeof item === 'string')
  const out: string[] = []
  for (const message of messages) {
    const match = FIELD_MESSAGES.find(([pattern]) => pattern.test(message))
    if (match && !out.includes(match[1])) out.push(match[1])
  }
  if (out.length > 0) return out.join(' ')
  if (status === 413) return 'Снимките са твърде големи. Махни някоя и опитай пак.'
  if (status === 429) return 'Твърде много опити. Изчакай минута и опитай пак.'
  if (status >= 500 || status === 0) return `${subject} не беше изпратен. Системата не отговаря, опитай пак след малко.`
  return `${subject} не беше изпратен. Провери полетата и опитай пак.`
}

async function postJson(fetcher: Fetch, path: string, body: unknown, recaptchaToken?: string) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': 'bg-BG',
    'Content-Type': 'application/json',
  }
  if (recaptchaToken) headers['x-recaptcha-token'] = recaptchaToken
  let response: Response
  try {
    response = await fetcher(`${violationsApi()}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch {
    return { status: 0, data: null as unknown }
  }
  const data = (await response.json().catch(() => null)) as unknown
  return { status: response.status, data }
}

export interface SendOptions {
  fetch?: Fetch
  /** reCAPTCHA v3 token per request. The API ignores it while reCAPTCHA is off. */
  recaptcha?: (action: string) => Promise<string>
}

export async function sendViolation(payload: ViolationPayload, photos: StoredPhoto[], options: SendOptions = {}): Promise<SendResult> {
  const fetcher: Fetch = options.fetch ?? ((input, init) => fetch(input, init))
  const token = async (action: string) => (options.recaptcha ? await options.recaptcha(action).catch(() => '') : '')
  const pictures: SentPicture[] = []
  for (const photo of photos) {
    const result = await postJson(
      fetcher,
      'pictures',
      { image: `data:${photo.contentType};base64,${photo.data}` },
      await token('sendViolationImage'),
    )
    const picture = result.data as { id?: unknown; url?: unknown } | null
    if (result.status < 200 || result.status >= 300 || typeof picture?.id !== 'string') {
      return { ok: false, message: `Снимките не се качиха. ${apiErrorMessage(result.status, result.data)}` }
    }
    pictures.push({ id: picture.id, url: typeof picture.url === 'string' ? picture.url : '' })
  }
  const result = await postJson(
    fetcher,
    'violations',
    violationBody(
      payload,
      pictures.map((picture) => picture.id),
    ),
    await token('sendViolation'),
  )
  const created = result.data as { id?: unknown; secret?: unknown } | null
  if (result.status < 200 || result.status >= 300 || typeof created?.id !== 'string') {
    return { ok: false, message: apiErrorMessage(result.status, result.data) }
  }
  return { ok: true, id: created.id, secret: typeof created.secret === 'string' ? created.secret : '', pictures }
}

export interface VideoSignal {
  section: string
  town: number
  description: string
  name: string
  email: string
  phone: string
}

/** A signal about what the official stream from a section shows (results: Section.js, type 'video'). */
export async function sendVideoViolation(signal: VideoSignal, options: SendOptions = {}): Promise<SendResult> {
  const fetcher: Fetch = options.fetch ?? ((input, init) => fetch(input, init))
  const token = options.recaptcha ? await options.recaptcha('sendViolation').catch(() => '') : ''
  const result = await postJson(
    fetcher,
    'violations',
    {
      description: signal.description,
      section: signal.section,
      town: signal.town,
      name: signal.name,
      email: signal.email,
      phone: apiPhone(signal.phone),
      type: 'video',
    },
    token,
  )
  const created = result.data as { id?: unknown; secret?: unknown } | null
  if (result.status < 200 || result.status >= 300 || typeof created?.id !== 'string') {
    return { ok: false, message: apiErrorMessage(result.status, result.data) }
  }
  return { ok: true, id: created.id, secret: typeof created.secret === 'string' ? created.secret : '', pictures: [] }
}

export interface ApiViolation {
  id: string
  description: string
  status: string
  createdAt: string
  townName: string
  sectionId: string
  pictures: string[]
}

/** The sender's own view of a violation, with the secret the API returned on create. */
export async function fetchOwnViolation(id: string, secret: string, fetcher: Fetch = (input, init) => fetch(input, init)): Promise<ApiViolation | null> {
  if (!id || !secret) return null
  try {
    const response = await fetcher(`${violationsApi()}/violations/${encodeURIComponent(id)}?secret=${encodeURIComponent(secret)}`, {
      headers: { Accept: 'application/json', 'Accept-Language': 'bg-BG' },
    })
    if (!response.ok) return null
    const data = (await response.json()) as {
      id?: string
      description?: string
      status?: string
      createdAt?: string
      town?: { name?: string }
      section?: { id?: string } | null
      pictures?: { url?: string }[]
    }
    if (typeof data.id !== 'string') return null
    return {
      id: data.id,
      description: data.description ?? '',
      status: data.status ?? '',
      createdAt: data.createdAt ?? '',
      townName: data.town?.name ?? '',
      sectionId: data.section?.id ?? '',
      pictures: (data.pictures ?? []).map((picture) => picture.url ?? '').filter(Boolean),
    }
  } catch {
    return null
  }
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Получен',
  processing: 'Обработва се',
  processed: 'Обработен',
  rejected: 'Отхвърлен',
}

export function violationStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? 'Получен'
}

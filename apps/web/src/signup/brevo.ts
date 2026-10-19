import { env } from 'cloudflare:workers'
import { parseBrevoLists, type BrevoListSummary } from './brevo-lists'
import {
  checkBrevoAttributes,
  checkBrevoSender,
  mapBrevoHttpError,
  type BrevoAttrDescriptor,
  type BrevoImportContact,
} from './brevo-sync'

export type { BrevoListSummary } from './brevo-lists'

const API = 'https://api.brevo.com/v3'

export type BrevoConfig = {
  apiKey: string
  listId: number | null
  templateId: number | null
  senderEmail: string
  senderName: string
}

export class BrevoApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'BrevoApiError'
    this.status = status
    this.code = code
  }
}

export function readBrevoConfig(): BrevoConfig | { missing: string } {
  const bag = env as unknown as {
    BREVO_API_KEY?: string
    BREVO_LIST_ID?: string
    BREVO_TEMPLATE_ID?: string
    BREVO_SENDER_EMAIL?: string
    BREVO_SENDER_NAME?: string
  }
  const apiKey = (bag.BREVO_API_KEY ?? '').trim()
  if (!apiKey) return { missing: 'BREVO_API_KEY' }
  return {
    apiKey,
    listId: parsePositiveInt(bag.BREVO_LIST_ID),
    templateId: parsePositiveInt(bag.BREVO_TEMPLATE_ID),
    senderEmail: (bag.BREVO_SENDER_EMAIL ?? 'team@tibroish.bg').trim(),
    senderName: (bag.BREVO_SENDER_NAME ?? 'Ти броиш').trim(),
  }
}

export async function importContactsToList(
  config: BrevoConfig,
  contacts: BrevoImportContact[],
  listId: number,
  fetchImpl: typeof fetch = fetch,
) {
  return brevoFetch(
    config.apiKey,
    '/contacts/import',
    {
      method: 'POST',
      body: JSON.stringify({
        jsonBody: contacts.map((contact) => ({
          email: contact.email,
          attributes: contact.attributes ?? {},
        })),
        listIds: [listId],
        updateExistingContacts: true,
        emptyContactsAttributes: false,
        disableNotification: true,
      }),
    },
    fetchImpl,
  )
}

export async function createEmailCampaign(
  config: BrevoConfig,
  input: {
    name: string
    subject: string
    listId: number
    htmlContent?: string
    templateId?: number
  },
  fetchImpl: typeof fetch = fetch,
) {
  const body: Record<string, unknown> = {
    name: input.name,
    subject: input.subject,
    sender: { name: config.senderName, email: config.senderEmail },
    replyTo: config.senderEmail,
    recipients: { listIds: [input.listId] },
  }
  if (input.templateId) body.templateId = input.templateId
  else body.htmlContent = input.htmlContent ?? defaultCampaignHtml()
  const created = await brevoFetch(
    config.apiKey,
    '/emailCampaigns',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    fetchImpl,
  )
  if (typeof created === 'object' && created && 'id' in created && typeof created.id === 'number') return { id: created.id }
  throw new Error('Brevo не върна номер на кампанията.')
}

export async function fetchBrevoProcess(config: BrevoConfig, processId: string | number, fetchImpl: typeof fetch = fetch) {
  return brevoFetch(config.apiKey, `/processes/${encodeURIComponent(String(processId))}`, { method: 'GET' }, fetchImpl)
}

export async function sendEmailCampaignNow(config: BrevoConfig, campaignId: number, fetchImpl: typeof fetch = fetch) {
  return brevoFetch(
    config.apiKey,
    `/emailCampaigns/${campaignId}/sendNow`,
    {
      method: 'POST',
    },
    fetchImpl,
  )
}

export type BrevoHealthReport = {
  account: { ok: boolean; companyName?: string; email?: string; plan?: string; credits?: number; error?: string }
  list: { ok: boolean; id: number | null; name?: string; totalSubscribers?: number; error?: string }
  attributes: {
    ok: boolean
    missing: string[]
    wrongType: Array<{ name: string; expected: string[]; actual: string }>
    roleLabelGaps: string[]
    error?: string
  }
  sender: { ok: boolean; email: string; message: string; error?: string }
}

export async function fetchBrevoHealth(config: BrevoConfig, fetchImpl: typeof fetch = fetch): Promise<BrevoHealthReport> {
  const account = await checkAccount(config, fetchImpl)
  const list = await checkList(config, fetchImpl)
  const attributes = await checkAttributes(config, fetchImpl)
  const sender = await checkSender(config, fetchImpl)
  return { account, list, attributes, sender }
}

export async function fetchBrevoAttributeDescriptors(
  config: BrevoConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<BrevoAttrDescriptor[]> {
  const json = await brevoFetch(config.apiKey, '/contacts/attributes', { method: 'GET' }, fetchImpl)
  return parseAttributeList(json)
}

const LISTS_PAGE_SIZE = 50
const LISTS_MAX_PAGES = 20

/** Read-only GET /contacts/lists with pagination until `count` is covered (cap 20 pages). */
export async function fetchBrevoLists(
  config: BrevoConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<BrevoListSummary[]> {
  const collected: BrevoListSummary[] = []
  let total = Number.POSITIVE_INFINITY
  for (let page = 0; page < LISTS_MAX_PAGES; page += 1) {
    const offset = page * LISTS_PAGE_SIZE
    if (offset >= total) break
    const json = (await brevoFetch(
      config.apiKey,
      `/contacts/lists?limit=${LISTS_PAGE_SIZE}&offset=${offset}&sort=desc`,
      { method: 'GET' },
      fetchImpl,
    )) as { count?: unknown }
    if (typeof json.count === 'number' && Number.isFinite(json.count) && json.count >= 0) {
      total = json.count
    }
    const pageLists = parseBrevoLists(json)
    collected.push(...pageLists)
    if (pageLists.length === 0) break
    if (collected.length >= total) break
  }
  const byId = new Map<number, BrevoListSummary>()
  for (const list of collected) byId.set(list.id, list)
  return [...byId.values()].sort((a, b) => b.id - a.id)
}

/** GET /contacts/lists/{id}. Maps 404 to a Bulgarian „Списък N не съществува…“ error. */
export async function fetchBrevoList(
  config: BrevoConfig,
  id: number,
  fetchImpl: typeof fetch = fetch,
): Promise<BrevoListSummary> {
  try {
    const json = (await brevoFetch(config.apiKey, `/contacts/lists/${id}`, { method: 'GET' }, fetchImpl)) as {
      id?: number
      name?: string
      uniqueSubscribers?: number
      totalSubscribers?: number
    }
    return {
      id: typeof json.id === 'number' ? json.id : id,
      name: typeof json.name === 'string' && json.name.trim() ? json.name.trim() : `Списък ${id}`,
      subscribers: json.uniqueSubscribers ?? json.totalSubscribers ?? 0,
    }
  } catch (error) {
    if (error instanceof BrevoApiError && error.status === 404) {
      throw new BrevoApiError(404, error.code, `Списък ${id} не съществува в Brevo.`)
    }
    throw error
  }
}

export async function brevoFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'api-key': apiKey,
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!response.ok) {
    const message =
      typeof json === 'object' && json && 'message' in json
        ? String((json as { message: unknown }).message)
        : `Brevo HTTP ${response.status}`
    const code =
      typeof json === 'object' && json && 'code' in json ? String((json as { code: unknown }).code) : ''
    throw new BrevoApiError(response.status, code, mapBrevoHttpError(response.status, message, code))
  }
  return json
}

async function checkAccount(config: BrevoConfig, fetchImpl: typeof fetch) {
  try {
    const json = (await brevoFetch(config.apiKey, '/account', { method: 'GET' }, fetchImpl)) as {
      companyName?: string
      email?: string
      plan?: Array<{ type?: string; credits?: number }> | { type?: string; credits?: number }
    }
    const planParts = Array.isArray(json.plan) ? json.plan : json.plan ? [json.plan] : []
    const plan = planParts.map((item) => item.type).filter(Boolean).join(', ')
    const credits = planParts.reduce((sum, item) => sum + (typeof item.credits === 'number' ? item.credits : 0), 0)
    return {
      ok: true as const,
      companyName: json.companyName,
      email: json.email,
      plan: plan || undefined,
      credits: credits || undefined,
    }
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) }
  }
}

async function checkList(config: BrevoConfig, fetchImpl: typeof fetch) {
  if (!config.listId) {
    return {
      ok: false as const,
      id: null,
      error: 'Липсва BREVO_LIST_ID. Задай числовия ID на списъка в Brevo.',
    }
  }
  try {
    const list = await fetchBrevoList(config, config.listId, fetchImpl)
    return {
      ok: true as const,
      id: list.id,
      name: list.name,
      totalSubscribers: list.subscribers,
    }
  } catch (error) {
    return { ok: false as const, id: config.listId, error: errorMessage(error) }
  }
}

async function checkAttributes(config: BrevoConfig, fetchImpl: typeof fetch) {
  try {
    const attrs = await fetchBrevoAttributeDescriptors(config, fetchImpl)
    const result = checkBrevoAttributes(attrs)
    return {
      ok: result.ok,
      missing: result.missing,
      wrongType: result.wrongType,
      roleLabelGaps: result.roleLabelGaps,
    }
  } catch (error) {
    return {
      ok: false as const,
      missing: [] as string[],
      wrongType: [] as Array<{ name: string; expected: string[]; actual: string }>,
      roleLabelGaps: [] as string[],
      error: errorMessage(error),
    }
  }
}

async function checkSender(config: BrevoConfig, fetchImpl: typeof fetch) {
  try {
    const json = (await brevoFetch(config.apiKey, '/senders', { method: 'GET' }, fetchImpl)) as {
      senders?: Array<{ email?: string; active?: boolean; verified?: boolean }>
    }
    const report = checkBrevoSender(json.senders ?? [], config.senderEmail)
    return {
      ok: report.found && report.active,
      email: report.email,
      message: report.message,
    }
  } catch (error) {
    return {
      ok: false as const,
      email: config.senderEmail,
      message: '',
      error: errorMessage(error),
    }
  }
}

function parseAttributeList(json: unknown): BrevoAttrDescriptor[] {
  if (!json || typeof json !== 'object') return []
  const bag = json as { attributes?: unknown[]; data?: unknown[] }
  const list = Array.isArray(bag.attributes) ? bag.attributes : Array.isArray(bag.data) ? bag.data : []
  const parsed: BrevoAttrDescriptor[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as {
      name?: string
      type?: string
      category?: string
      enumeration?: Array<{ value?: number; label?: string }>
      multiCategoryOptions?: unknown[]
    }
    if (!row.name) continue
    parsed.push({
      name: row.name,
      type: row.type,
      category: row.category,
      enumeration: (row.enumeration ?? [])
        .filter((entry) => typeof entry.value === 'number' && typeof entry.label === 'string')
        .map((entry) => ({ value: entry.value as number, label: entry.label as string })),
      multiCategoryOptions: (row.multiCategoryOptions ?? []).flatMap((option) => {
        if (typeof option === 'string') return [option]
        if (option && typeof option === 'object' && 'value' in option) return [String((option as { value: unknown }).value)]
        return []
      }),
    })
  }
  return parsed
}

function errorMessage(error: unknown) {
  if (error instanceof BrevoApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Brevo повикването се провали.'
}

function parsePositiveInt(value: string | undefined) {
  const trimmed = (value ?? '').trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return n > 0 ? n : null
}

function defaultCampaignHtml() {
  return '<p>Здравей,</p><p>Това е чернова на кампания от админ панела на Ти Броиш. Замени съдържанието или ползвай BREVO_TEMPLATE_ID.</p>'
}

/** Remove contacts from a Brevo list. Does not delete the contact record. */
export async function removeContactsFromList(
  config: BrevoConfig,
  emails: string[],
  listId: number,
  fetchImpl: typeof fetch = fetch,
) {
  const cleaned = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
  if (cleaned.length === 0) return { removed: 0 }
  await brevoFetch(
    config.apiKey,
    `/contacts/lists/${listId}/contacts/remove`,
    {
      method: 'POST',
      body: JSON.stringify({ emails: cleaned }),
    },
    fetchImpl,
  )
  return { removed: cleaned.length }
}

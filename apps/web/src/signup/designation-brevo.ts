import { withRetry } from './designation-drive-core'

const API = 'https://api.brevo.com/v3'

function headers(apiKey: string) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'api-key': apiKey,
  }
}

async function brevoErrorMessage(response: Response) {
  const text = await response.text().catch(() => '')
  try {
    const json = text ? (JSON.parse(text) as { message?: string; code?: string }) : null
    if (json?.message) return json.code ? `${json.message} (${json.code})` : json.message
  } catch {
    /* keep status message */
  }
  return `Brevo HTTP ${response.status}`
}

export class BrevoContactError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'BrevoContactError'
  }
}

/**
 * PUT /contacts/{email}. Synchronous, so Brevo answers 400 for an unknown
 * attribute and 404 for a missing contact instead of dropping it quietly
 * (POST /contacts/import ignores attributes the account does not have).
 */
export async function updateBrevoContactAttribute(
  apiKey: string,
  email: string,
  attributes: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  listIds: number[] = [],
) {
  const body: { attributes: Record<string, string>; listIds?: number[] } = { attributes }
  if (listIds.length > 0) body.listIds = listIds
  const response = await withRetry(() =>
    fetchImpl(`${API}/contacts/${encodeURIComponent(email)}?identifierType=email_id`, {
      method: 'PUT',
      headers: headers(apiKey),
      body: JSON.stringify(body),
    }),
  )
  if (response.status === 204 || response.ok) return
  throw new BrevoContactError(response.status, await brevoErrorMessage(response))
}

/** POST /contacts with updateEnabled: creates the contact when PUT says it does not exist. */
export async function createBrevoContact(
  apiKey: string,
  email: string,
  attributes: Record<string, string>,
  listIds: number[],
  fetchImpl: typeof fetch = fetch,
) {
  const response = await withRetry(() =>
    fetchImpl(`${API}/contacts`, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({ email, attributes, listIds, updateEnabled: true }),
    }),
  )
  if (response.ok) return
  throw new BrevoContactError(response.status, await brevoErrorMessage(response))
}

/** Names of the contact attributes the Brevo account has (GET /contacts/attributes). */
export async function fetchBrevoAttributeNames(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<Set<string>> {
  const response = await withRetry(() => fetchImpl(`${API}/contacts/attributes`, { method: 'GET', headers: headers(apiKey) }))
  if (!response.ok) throw new BrevoContactError(response.status, await brevoErrorMessage(response))
  const json = (await response.json()) as { attributes?: Array<{ name?: unknown }> }
  return new Set((json.attributes ?? []).map((item) => String(item.name ?? '').toUpperCase()).filter(Boolean))
}

export type DesignationBrevoContact = { personId: string; email: string; url: string }
export type DesignationBrevoResult = { personId: string; ok: boolean; created?: boolean; error?: string }
export type DesignationBrevoSync = {
  attribute: string
  attributeMissing: boolean
  results: DesignationBrevoResult[]
}

/**
 * Push each signed пълномощно link to its Brevo contact and report every person.
 * Checks once that the attribute exists, because Brevo can drop unknown attributes.
 */
export async function syncDesignationLinks(opts: {
  apiKey: string
  listId: number | null
  attribute: string
  contacts: DesignationBrevoContact[]
  fetchImpl?: typeof fetch
  concurrency?: number
}): Promise<DesignationBrevoSync> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const attribute = opts.attribute.trim().toUpperCase()
  const names = await fetchBrevoAttributeNames(opts.apiKey, fetchImpl)
  if (!names.has(attribute)) {
    const error = `В Brevo няма атрибут ${attribute}.`
    return {
      attribute,
      attributeMissing: true,
      results: opts.contacts.map((contact) => ({ personId: contact.personId, ok: false, error })),
    }
  }
  const listIds = opts.listId ? [opts.listId] : []
  const results: DesignationBrevoResult[] = new Array(opts.contacts.length)
  let index = 0
  const worker = async () => {
    while (index < opts.contacts.length) {
      const current = index
      index += 1
      const contact = opts.contacts[current]!
      const attributes = { [attribute]: contact.url }
      try {
        await updateBrevoContactAttribute(opts.apiKey, contact.email, attributes, fetchImpl, listIds)
        results[current] = { personId: contact.personId, ok: true }
      } catch (error) {
        if (error instanceof BrevoContactError && error.status === 404) {
          try {
            await createBrevoContact(opts.apiKey, contact.email, attributes, listIds, fetchImpl)
            results[current] = { personId: contact.personId, ok: true, created: true }
            continue
          } catch (createError) {
            results[current] = { personId: contact.personId, ok: false, error: describe(createError) }
            continue
          }
        }
        results[current] = { personId: contact.personId, ok: false, error: describe(error) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, opts.contacts.length) }, worker))
  return { attribute, attributeMissing: false, results }
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : 'Brevo повикването се провали.'
}

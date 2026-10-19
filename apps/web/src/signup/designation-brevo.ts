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
export type DesignationBrevoCheck = { personId: string; ok: boolean; error?: string }
export type DesignationBrevoSync = {
  attribute: string
  attributeMissing: boolean
  results: DesignationBrevoResult[]
  /** Read-back of one updated contact, so a request Brevo accepted but did not store shows up as an error. */
  check?: DesignationBrevoCheck
}

/** GET /contacts/{email}: the stored value of one attribute ('' when unset). */
export async function readBrevoContactAttribute(apiKey: string, email: string, attribute: string, fetchImpl: typeof fetch = fetch) {
  const response = await withRetry(() =>
    fetchImpl(`${API}/contacts/${encodeURIComponent(email)}?identifierType=email_id`, { method: 'GET', headers: headers(apiKey) }),
  )
  if (!response.ok) throw new BrevoContactError(response.status, await brevoErrorMessage(response))
  const json = (await response.json()) as { attributes?: Record<string, unknown> }
  const bag = json.attributes ?? {}
  const key = Object.keys(bag).find((name) => name.toUpperCase() === attribute.toUpperCase())
  const value = key ? bag[key] : undefined
  return value == null ? '' : String(value)
}

/**
 * Put one signed link on its Brevo contact: PUT by email, and create the contact
 * (with the list) when Brevo says it does not exist.
 */
export async function pushDesignationLink(opts: {
  apiKey: string
  listId: number | null
  attribute: string
  contact: DesignationBrevoContact
  fetchImpl?: typeof fetch
}): Promise<DesignationBrevoResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const attributes = { [opts.attribute.trim().toUpperCase()]: opts.contact.url }
  const listIds = opts.listId ? [opts.listId] : []
  const { personId, email } = opts.contact
  try {
    await updateBrevoContactAttribute(opts.apiKey, email, attributes, fetchImpl, listIds)
    return { personId, ok: true }
  } catch (error) {
    if (!(error instanceof BrevoContactError) || error.status !== 404) return { personId, ok: false, error: describe(error) }
  }
  try {
    await createBrevoContact(opts.apiKey, email, attributes, listIds, fetchImpl)
    return { personId, ok: true, created: true }
  } catch (createError) {
    return { personId, ok: false, error: describe(createError) }
  }
}

/** Read the attribute back from Brevo for one contact and say whether it holds the link we sent. */
export async function checkDesignationLink(opts: {
  apiKey: string
  attribute: string
  contact: DesignationBrevoContact
  fetchImpl?: typeof fetch
}): Promise<DesignationBrevoCheck> {
  const attribute = opts.attribute.trim().toUpperCase()
  try {
    const stored = await readBrevoContactAttribute(opts.apiKey, opts.contact.email, attribute, opts.fetchImpl ?? fetch)
    if (stored === opts.contact.url) return { personId: opts.contact.personId, ok: true }
    return {
      personId: opts.contact.personId,
      ok: false,
      error: stored
        ? `Brevo прие заявката, но ${attribute} в контакта още е стария линк.`
        : `Brevo прие заявката, но ${attribute} в контакта е празен.`,
    }
  } catch (error) {
    return { personId: opts.contact.personId, ok: false, error: `Проверката в Brevo се провали: ${describe(error)}` }
  }
}

/**
 * Push each signed пълномощно link to its Brevo contact and report every person.
 * Checks once that the attribute exists, because Brevo can drop unknown attributes,
 * and reads one updated contact back to prove the value was stored.
 */
export async function syncDesignationLinks(opts: {
  apiKey: string
  listId: number | null
  attribute: string
  contacts: DesignationBrevoContact[]
  fetchImpl?: typeof fetch
  concurrency?: number
  verify?: boolean
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
  const results: DesignationBrevoResult[] = new Array(opts.contacts.length)
  let index = 0
  const worker = async () => {
    while (index < opts.contacts.length) {
      const current = index
      index += 1
      const contact = opts.contacts[current]!
      results[current] = await pushDesignationLink({ apiKey: opts.apiKey, listId: opts.listId, attribute, contact, fetchImpl })
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, opts.contacts.length) }, worker))
  let check: DesignationBrevoCheck | undefined
  if (opts.verify !== false) {
    const firstOk = opts.contacts.find((_, i) => results[i]?.ok)
    if (firstOk) {
      check = await checkDesignationLink({ apiKey: opts.apiKey, attribute, contact: firstOk, fetchImpl })
      if (!check.ok) {
        const at = opts.contacts.indexOf(firstOk)
        results[at] = { personId: firstOk.personId, ok: false, error: check.error }
      }
    }
  }
  return { attribute, attributeMissing: false, results, check }
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : 'Brevo повикването се провали.'
}

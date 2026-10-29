import { withRetry } from './designation-drive-core'
import { buildBrevoContact } from './brevo-contact'
import { convertRoleForBrevo, type BrevoAttrDescriptor } from './brevo-sync'
import { hasRealEmail } from './no-email'

export type BrevoAttrValue = string | number | boolean | string[]
export type BrevoAttrs = Record<string, BrevoAttrValue>

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

export const NO_EMAIL_BREVO = 'няма имейл'

/**
 * Last line of defence: a volunteer without an e-mail (no-email.ts) never reaches the Brevo API.
 * Callers skip such people before this; status 0 means no request was made.
 */
function assertBrevoEmail(email: string) {
  if (!hasRealEmail(email)) throw new BrevoContactError(0, NO_EMAIL_BREVO)
}

/**
 * PUT /contacts/{email}. Synchronous, so Brevo answers 400 for an unknown
 * attribute and 404 for a missing contact instead of dropping it quietly
 * (POST /contacts/import ignores attributes the account does not have).
 */
export async function updateBrevoContactAttribute(
  apiKey: string,
  email: string,
  attributes: BrevoAttrs,
  fetchImpl: typeof fetch = fetch,
  listIds: number[] = [],
) {
  assertBrevoEmail(email)
  const body: { attributes: BrevoAttrs; listIds?: number[] } = { attributes }
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
  attributes: BrevoAttrs,
  listIds: number[],
  fetchImpl: typeof fetch = fetch,
) {
  assertBrevoEmail(email)
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

/** Contact attributes the Brevo account has (GET /contacts/attributes). */
export async function fetchBrevoAttributes(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<BrevoAttrDescriptor[]> {
  const response = await withRetry(() => fetchImpl(`${API}/contacts/attributes`, { method: 'GET', headers: headers(apiKey) }))
  if (!response.ok) throw new BrevoContactError(response.status, await brevoErrorMessage(response))
  const json = (await response.json()) as { attributes?: BrevoAttrDescriptor[] }
  return (json.attributes ?? []).filter((item) => item && typeof item.name === 'string' && item.name)
}

/** Names of the contact attributes the Brevo account has, upper-case. */
export async function fetchBrevoAttributeNames(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<Set<string>> {
  return new Set((await fetchBrevoAttributes(apiKey, fetchImpl)).map((item) => item.name.toUpperCase()))
}

/** Section fields of one person, as the Секции → Brevo sync builds them. */
export type DesignationSectionFields = {
  firstName: string
  lastName: string
  mir: string
  publishedSection: string
  sectionAddress: string
  sectionPlace: string
  /** LOCATION in Brevo: town (or city and country abroad); defaults to sectionPlace. */
  location?: string
  role: string
}

/** Attributes the пълномощно update never sends: SMS can belong to another contact and would fail the whole PUT. */
const SECTION_ATTRIBUTE_KEYS = [
  'FIRSTNAME',
  'LASTNAME',
  'MIR',
  'SECTION_ID',
  'SECTION_CODE',
  'SECTION_ID_TEXT',
  'SECTION_ADDRESS',
  'SECTION_PLACE',
  'LOCATION',
  'SECTION_PUBLISHED',
  'ROLE',
] as const

/**
 * Section attributes to send with the signed link, so a contact never ends up with a
 * DOCUMENT_URL but no section. Only non-empty values, and only attributes the account
 * has: a blank never replaces a stored value and an unknown attribute never fails the PUT.
 */
export function designationSectionAttributes(fields: DesignationSectionFields, account: BrevoAttrDescriptor[]): BrevoAttrs {
  const known = new Map(account.map((attr) => [attr.name.toUpperCase(), attr]))
  const built = buildBrevoContact({
    email: '',
    firstName: fields.firstName.trim(),
    lastName: fields.lastName.trim(),
    phone: '',
    mir: fields.mir,
    publishedSection: fields.publishedSection,
    sectionAddress: fields.sectionAddress.trim(),
    sectionPlace: fields.sectionPlace.trim(),
    role: fields.role,
    sectionPublished: true,
  }).attributes
  const out: BrevoAttrs = {}
  for (const key of SECTION_ATTRIBUTE_KEYS) {
    if (!known.has(key)) continue
    if (key === 'ROLE') {
      if (!built.ROLE) continue
      const converted = convertRoleForBrevo(built.ROLE, known.get('ROLE'))
      if (converted.ok) out.ROLE = converted.value
      continue
    }
    const type = String(known.get(key)?.type ?? '').toLowerCase()
    if (key === 'SECTION_PUBLISHED') {
      // Only ever set to true here; unpublishing is the Секции sync's job.
      if (built.SECTION_PUBLISHED) out.SECTION_PUBLISHED = type === 'boolean' || type === '' ? true : 'yes'
      continue
    }
    const value = key === 'LOCATION' ? (fields.location ?? fields.sectionPlace).trim() : built[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    // A text value never goes into a category/date/… attribute: Brevo would refuse the whole update.
    if (typeof value === 'string' && type !== '' && type !== 'text' && type !== 'float' && type !== 'number') continue
    if (type === 'text') out[key] = String(value)
    else if (type === 'float' || type === 'number') {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) out[key] = numeric
    } else out[key] = value
  }
  return out
}

export type DesignationBrevoContact = {
  personId: string
  email: string
  url: string
  /** Section attributes sent in the same update (see designationSectionAttributes). */
  section?: BrevoAttrs
}
export type DesignationBrevoResult = {
  personId: string
  ok: boolean
  created?: boolean
  error?: string
  /** Set when the link was stored but Brevo refused the section attributes. */
  warning?: string
  /** Not sent on purpose (no e-mail): not a Brevo failure. */
  skipped?: boolean
}
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
  assertBrevoEmail(email)
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
  const link = { [opts.attribute.trim().toUpperCase()]: opts.contact.url }
  const section = opts.contact.section ?? {}
  const withSection: BrevoAttrs = { ...section, ...link }
  const hasSection = Object.keys(section).length > 0
  const listIds = opts.listId ? [opts.listId] : []
  const { personId, email } = opts.contact
  if (!hasRealEmail(email)) return { personId, ok: false, skipped: true, error: NO_EMAIL_BREVO }
  const put = (attributes: BrevoAttrs) => updateBrevoContactAttribute(opts.apiKey, email, attributes, fetchImpl, listIds)
  const create = (attributes: BrevoAttrs) => createBrevoContact(opts.apiKey, email, attributes, listIds, fetchImpl)
  // A 400 on the section attributes must not cost the signed link: retry with the link alone.
  const sectionRefused = (error: unknown) => hasSection && error instanceof BrevoContactError && error.status === 400
  const warningOf = (error: unknown) => `секционните атрибути не минаха: ${describe(error)}`
  try {
    await put(withSection)
    return { personId, ok: true }
  } catch (error) {
    if (sectionRefused(error)) {
      try {
        await put(link)
        return { personId, ok: true, warning: warningOf(error) }
      } catch (linkError) {
        if (!(linkError instanceof BrevoContactError) || linkError.status !== 404) return { personId, ok: false, error: describe(linkError) }
      }
    } else if (!(error instanceof BrevoContactError) || error.status !== 404) {
      return { personId, ok: false, error: describe(error) }
    }
  }
  try {
    await create(withSection)
    return { personId, ok: true, created: true }
  } catch (createError) {
    if (sectionRefused(createError)) {
      try {
        await create(link)
        return { personId, ok: true, created: true, warning: warningOf(createError) }
      } catch (linkError) {
        return { personId, ok: false, error: describe(linkError) }
      }
    }
    return { personId, ok: false, error: describe(createError) }
  }
}

/**
 * Upsert one contact with its section attributes (and the signed link when there is one): PUT by
 * email with the list, and create the contact when Brevo says it does not exist. Contacts only:
 * no campaign, no transactional mail. Never sends SMS (it can belong to another contact).
 */
export async function pushSectionContact(opts: {
  apiKey: string
  listId: number | null
  personId: string
  email: string
  attributes: BrevoAttrs
  fetchImpl?: typeof fetch
}): Promise<DesignationBrevoResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const listIds = opts.listId ? [opts.listId] : []
  const { personId, email, attributes } = opts
  if (!hasRealEmail(email)) return { personId, ok: false, skipped: true, error: NO_EMAIL_BREVO }
  if (Object.keys(attributes).length === 0) return { personId, ok: false, error: 'няма секционни атрибути' }
  try {
    await updateBrevoContactAttribute(opts.apiKey, email, attributes, fetchImpl, listIds)
    return { personId, ok: true }
  } catch (error) {
    if (!(error instanceof BrevoContactError) || error.status !== 404) return { personId, ok: false, error: describe(error) }
  }
  try {
    await createBrevoContact(opts.apiKey, email, attributes, listIds, fetchImpl)
    return { personId, ok: true, created: true }
  } catch (error) {
    return { personId, ok: false, error: describe(error) }
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
  /** Brevo attribute descriptors, when the caller already fetched them. */
  account?: BrevoAttrDescriptor[]
}): Promise<DesignationBrevoSync> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const attribute = opts.attribute.trim().toUpperCase()
  const account = opts.account ?? (await fetchBrevoAttributes(opts.apiKey, fetchImpl))
  const names = new Set(account.map((item) => item.name.toUpperCase()))
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

/** Maps signup role keys to Brevo ROLE labels. Easy to change in one place. */
export const BREVO_ROLE_LABELS: Record<string, string> = {
  section: 'Представител',
  mobile: 'Представител',
  video: 'Наблюдател',
}

export const BREVO_SECTIONS_HEADERS = [
  'EMAIL',
  'FIRSTNAME',
  'LASTNAME',
  'SMS',
  'MIR',
  'SECTION_ID',
  'SECTION_CODE',
  'SECTION_ID_TEXT',
  'SECTION_ADDRESS',
  'SECTION_PLACE',
  'ROLE',
  'SECTION_PUBLISHED',
] as const

export type BrevoContactInput = {
  email: string
  firstName: string
  lastName: string
  phone: string
  mir: string
  publishedSection: string
  sectionAddress: string
  sectionPlace: string
  role: string
  sectionPublished: boolean
  palnomoshtnoUrl?: string
}

export type BrevoContactAttributes = {
  FIRSTNAME: string
  LASTNAME: string
  SMS: string
  MIR: string
  SECTION_ID?: number
  SECTION_CODE?: string
  SECTION_ID_TEXT?: string
  SECTION_ADDRESS: string
  SECTION_PLACE: string
  ROLE: string
  SECTION_PUBLISHED: boolean
  DOCUMENT_URL?: string
}

export type BrevoBuiltContact = {
  email: string
  attributes: BrevoContactAttributes
}

/**
 * Normalize a phone to Brevo SMS / E.164: leading +, country code, digits only.
 * Bulgarian national numbers (0… / 8… / 9…) become +359…. Empty when not plausibly valid.
 */
export function normalizeBrevoSms(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  let digits = trimmed.replace(/\D/g, '')
  if (digits.startsWith('00') && digits.length > 2) digits = digits.slice(2)
  if (/^0[1-9]\d{7,8}$/.test(digits)) digits = `359${digits.slice(1)}`
  else if (/^[89]\d{8}$/.test(digits)) digits = `359${digits}`
  if (!/^\d{6,15}$/.test(digits) || digits.startsWith('0')) return ''
  return `+${digits}`
}

export function brevoRoleLabel(role: string) {
  const key = role.trim()
  if (!key) return ''
  return BREVO_ROLE_LABELS[key] ?? ''
}

export function buildBrevoContact(input: BrevoContactInput): BrevoBuiltContact {
  const digits = normalizeSectionDigits(input.publishedSection)
  const published = input.sectionPublished && /^\d{9}$/.test(digits)
  const mirRaw = input.mir.trim() || mirFromSectionDigits(digits)
  const mir = mirRaw ? mirRaw.padStart(2, '0').slice(-2) : ''
  const attributes: BrevoContactAttributes = {
    FIRSTNAME: input.firstName,
    LASTNAME: input.lastName,
    SMS: normalizeBrevoSms(input.phone),
    MIR: mir,
    SECTION_ADDRESS: input.sectionAddress,
    SECTION_PLACE: input.sectionPlace,
    ROLE: brevoRoleLabel(input.role),
    SECTION_PUBLISHED: published,
  }
  const palnomoshtnoUrl = (input.palnomoshtnoUrl ?? '').trim()
  if (palnomoshtnoUrl) attributes.DOCUMENT_URL = palnomoshtnoUrl
  if (published) {
    attributes.SECTION_ID = Number(digits)
    attributes.SECTION_CODE = digits
    attributes.SECTION_ID_TEXT = digits
  }
  return {
    email: input.email.trim().toLowerCase(),
    attributes,
  }
}

/**
 * Brevo's contact import (/contacts/import and CSV) only understands yes/no for
 * boolean attributes. JSON true, "true" and 1 are dropped without an error.
 */
export function brevoImportBoolean(value: boolean) {
  return value ? 'yes' : 'no'
}

/** Drop empty-string attributes for API upserts; always keep SECTION_PUBLISHED. */
export function brevoAttributesForApi(
  attributes: BrevoContactAttributes,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    SECTION_PUBLISHED: brevoImportBoolean(attributes.SECTION_PUBLISHED),
  }
  const put = (key: string, value: string | number | boolean | undefined) => {
    if (value === undefined) return
    if (typeof value === 'string' && value === '') return
    out[key] = value
  }
  put('FIRSTNAME', attributes.FIRSTNAME)
  put('LASTNAME', attributes.LASTNAME)
  put('SMS', attributes.SMS)
  put('MIR', attributes.MIR)
  put('SECTION_ID', attributes.SECTION_ID)
  put('SECTION_CODE', attributes.SECTION_CODE)
  put('SECTION_ID_TEXT', attributes.SECTION_ID_TEXT)
  put('SECTION_ADDRESS', attributes.SECTION_ADDRESS)
  put('SECTION_PLACE', attributes.SECTION_PLACE)
  put('ROLE', attributes.ROLE)
  put('DOCUMENT_URL', attributes.DOCUMENT_URL)
  return out
}

export function brevoContactCsvCells(contact: BrevoBuiltContact): string[] {
  const a = contact.attributes
  return [
    contact.email,
    a.FIRSTNAME,
    a.LASTNAME,
    a.SMS,
    a.MIR,
    a.SECTION_ID !== undefined ? String(a.SECTION_ID) : '',
    a.SECTION_CODE ?? '',
    a.SECTION_ID_TEXT ?? '',
    a.SECTION_ADDRESS,
    a.SECTION_PLACE,
    a.ROLE,
    brevoImportBoolean(a.SECTION_PUBLISHED),
  ]
}

function normalizeSectionDigits(value: string) {
  return value.trim().replace(/\s+/g, '').replace(/\D/g, '')
}

function mirFromSectionDigits(digits: string) {
  if (digits.length < 8) return ''
  return digits.slice(0, 2)
}

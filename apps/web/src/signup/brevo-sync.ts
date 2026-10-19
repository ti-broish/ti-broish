/** Max contacts per Brevo /contacts/import call. */
export const BREVO_IMPORT_MAX_CONTACTS = 1000

/** Soft byte budget for the jsonBody array serialisation (Brevo hard limit is 8 MB). */
export const BREVO_IMPORT_MAX_BYTES = 5 * 1024 * 1024

export type BrevoImportContact = {
  email: string
  attributes: Record<string, string | number | boolean | string[]>
}

/**
 * Split contacts into batches of at most `maxCount`, further splitting when a
 * serialised `jsonBody` would exceed `maxBytes`.
 */
export function chunkContacts(
  contacts: BrevoImportContact[],
  maxCount = BREVO_IMPORT_MAX_CONTACTS,
  maxBytes = BREVO_IMPORT_MAX_BYTES,
): BrevoImportContact[][] {
  if (contacts.length === 0) return []
  const batches: BrevoImportContact[][] = []
  let batch: BrevoImportContact[] = []
  let batchBytes = 2 // []

  const pushBatch = () => {
    if (batch.length === 0) return
    batches.push(batch)
    batch = []
    batchBytes = 2
  }

  for (const contact of contacts) {
    const piece = JSON.stringify(contact)
    const extra = batch.length === 0 ? piece.length : piece.length + 1 // comma
    if (batch.length > 0 && (batch.length >= maxCount || batchBytes + extra > maxBytes)) {
      pushBatch()
    }
    if (batch.length === 0) {
      batch = [contact]
      batchBytes = 2 + piece.length
      if (batchBytes > maxBytes) {
        // Single oversized contact still goes alone; Brevo will reject if truly too large.
        pushBatch()
      }
      continue
    }
    batch.push(contact)
    batchBytes += extra
  }
  pushBatch()
  return batches
}

export type BrevoAttrEnumeration = { value: number; label: string }

export type BrevoAttrDescriptor = {
  name: string
  type?: string
  category?: string
  enumeration?: BrevoAttrEnumeration[]
  /** Options of a normal multiple-choice attribute. */
  multiCategoryOptions?: string[]
}

/** Brevo marks a single-choice list as category "category" (with enumeration). */
export function isBrevoCategoryAttribute(attr: BrevoAttrDescriptor) {
  return (attr.category ?? '').toLowerCase() === 'category' || (attr.type ?? '').toLowerCase() === 'category'
}

/** Brevo marks a multiple-choice attribute as type "multiple-choice" in category "normal". */
export function isBrevoMultipleChoiceAttribute(attr: BrevoAttrDescriptor) {
  const type = (attr.type ?? '').toLowerCase()
  return type === 'multiple-choice' || type === 'multiple_choice'
}

/** Labels a choice attribute accepts, from either the enumeration or the multiple-choice options. */
export function brevoChoiceLabels(attr: BrevoAttrDescriptor) {
  return [...(attr.enumeration ?? []).map((item) => item.label), ...(attr.multiCategoryOptions ?? [])]
}

export type RoleConversion =
  | { ok: true; value: string | number | string[] }
  | { ok: false; omit: true; warning: string }

/**
 * Convert a ROLE label for Brevo import:
 * - category → enumeration integer
 * - multiple-choice → [label]
 * - text / unknown → label string
 * Missing enumeration entry → omit with warning.
 */
export function convertRoleForBrevo(label: string, roleAttr: BrevoAttrDescriptor | null | undefined): RoleConversion {
  const trimmed = label.trim()
  if (!trimmed) return { ok: false, omit: true, warning: 'Празен ROLE етикет.' }
  if (!roleAttr) return { ok: true, value: trimmed }

  if (isBrevoCategoryAttribute(roleAttr)) {
    const entry = (roleAttr.enumeration ?? []).find((item) => item.label === trimmed)
    if (!entry) {
      return {
        ok: false,
        omit: true,
        warning: `ROLE „${trimmed}“ липсва в изброяването на Brevo.`,
      }
    }
    return { ok: true, value: entry.value }
  }
  if (isBrevoMultipleChoiceAttribute(roleAttr)) {
    const options = roleAttr.multiCategoryOptions ?? []
    if (options.length > 0 && !options.includes(trimmed)) {
      return { ok: false, omit: true, warning: `ROLE „${trimmed}“ липсва в опциите на Brevo.` }
    }
    return { ok: true, value: [trimmed] }
  }
  return { ok: true, value: trimmed }
}

export type ExpectedBrevoAttribute = {
  name: string
  /** Accepted Brevo type strings (case-insensitive). */
  types: string[]
  /** For ROLE: both labels must appear in enumeration when type is category / multiple-choice. */
  requiredLabels?: string[]
}

export const BREVO_REQUIRED_ATTRIBUTES: ExpectedBrevoAttribute[] = [
  { name: 'SECTION_ID', types: ['float', 'number', 'double'] },
  { name: 'SECTION_CODE', types: ['text', 'string'] },
  { name: 'SECTION_ID_TEXT', types: ['text', 'string'] },
  { name: 'MIR', types: ['text', 'string'] },
  {
    name: 'ROLE',
    types: ['category', 'multiple-choice', 'multiple_choice'],
    requiredLabels: ['Наблюдател', 'Представител'],
  },
  { name: 'FIRSTNAME', types: ['text', 'string'] },
  { name: 'LASTNAME', types: ['text', 'string'] },
  { name: 'SMS', types: ['text', 'string'] },
  { name: 'SECTION_ADDRESS', types: ['text', 'string'] },
  { name: 'SECTION_PLACE', types: ['text', 'string'] },
  { name: 'SECTION_PUBLISHED', types: ['boolean', 'bool'] },
  { name: 'DOCUMENT_URL', types: ['text', 'string', 'url'] },
]

export type AttributeCheckResult = {
  missing: string[]
  wrongType: Array<{ name: string; expected: string[]; actual: string }>
  roleLabelGaps: string[]
  ok: boolean
}

export function checkBrevoAttributes(attributes: BrevoAttrDescriptor[]): AttributeCheckResult {
  const byName = new Map(attributes.map((attr) => [attr.name.toUpperCase(), attr]))
  const missing: string[] = []
  const wrongType: AttributeCheckResult['wrongType'] = []
  const roleLabelGaps: string[] = []

  for (const expected of BREVO_REQUIRED_ATTRIBUTES) {
    const found = byName.get(expected.name.toUpperCase())
    if (!found) {
      missing.push(expected.name)
      continue
    }
    const allowed = expected.types.map((t) => t.toLowerCase())
    if (expected.requiredLabels && expected.requiredLabels.length > 0) {
      if (!isBrevoCategoryAttribute(found) && !isBrevoMultipleChoiceAttribute(found)) {
        wrongType.push({ name: expected.name, expected: expected.types, actual: found.type || found.category || '' })
        continue
      }
      const labels = new Set(brevoChoiceLabels(found))
      for (const label of expected.requiredLabels) {
        if (!labels.has(label)) roleLabelGaps.push(label)
      }
      continue
    }
    const actual = (found.type ?? '').toLowerCase()
    if (!allowed.includes(actual)) {
      wrongType.push({ name: expected.name, expected: expected.types, actual: found.type || found.category || '' })
    }
  }

  return {
    missing,
    wrongType,
    roleLabelGaps,
    ok: missing.length === 0 && wrongType.length === 0 && roleLabelGaps.length === 0,
  }
}

/** Map Brevo 401 "unrecognised IP address <ip>" to a Bulgarian admin message. */
export function parseBrevoUnauthorisedIp(message: string): string | null {
  const match = /unrecognised IP address\s+(\S+)/i.exec(message)
  if (!match?.[1]) return null
  const ip = match[1].replace(/[.,;]+$/, '')
  return `Brevo отказва достъп: IP адресът ${ip} не е разрешен (Authorised IPs в Brevo → Security). Добави го или изключи ограничението.`
}

export function mapBrevoHttpError(status: number, message: string, code = ''): string {
  if (status === 401) {
    const ip = parseBrevoUnauthorisedIp(message)
    if (ip) return ip
    if (/key not found/i.test(message) || /unauthori[sz]ed/i.test(message) || code === 'unauthorized') {
      return 'Brevo API ключът е невалиден или липсва (401 Key not found). Провери BREVO_API_KEY.'
    }
  }
  if (status === 404) {
    return message.trim() || 'Brevo ресурсът не е намерен (404).'
  }
  return message.trim() || `Brevo HTTP ${status}`
}

export function maskEmail(email: string) {
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.indexOf('@')
  if (at <= 0) return '***'
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  const head = local.slice(0, 1)
  return `${head}***@${domain}`
}

export type SenderCheck = {
  email: string
  found: boolean
  active: boolean
  message: string
}

export function checkBrevoSender(
  senders: Array<{ email?: string; active?: boolean; verified?: boolean }>,
  expectedEmail: string,
): SenderCheck {
  const want = expectedEmail.trim().toLowerCase()
  const match = senders.find((sender) => (sender.email ?? '').trim().toLowerCase() === want)
  if (!match) {
    return {
      email: expectedEmail,
      found: false,
      active: false,
      message: `Подателят ${expectedEmail} не е в списъка на Brevo. Добави и потвърди team@tibroish.bg в Senders.`,
    }
  }
  const active = match.active !== false && match.verified !== false
  if (!active) {
    return {
      email: expectedEmail,
      found: true,
      active: false,
      message: `Подателят ${expectedEmail} е в Brevo, но не е потвърден/активен. Потвърди имейла в Brevo → Senders.`,
    }
  }
  return {
    email: expectedEmail,
    found: true,
    active: true,
    message: `Подателят ${expectedEmail} е активен.`,
  }
}

export type BrevoProcessReport = {
  id: string | number
  status: string
  issues: string[]
}

const IMPORT_ISSUE_LABELS: Record<string, string> = {
  invalid_emails: 'невалидни имейли',
  duplicate_contact_id: 'дублиран contact id',
  duplicate_ext_id: 'дублиран EXT_ID',
  duplicate_email_id: 'дублиран имейл',
  duplicate_phone_id: 'SMS номер, който вече е на друг контакт',
  duplicate_whatsapp_id: 'дублиран WhatsApp',
  duplicate_landline_number_id: 'дублиран стационарен номер',
}

/**
 * Read GET /processes/{id}. Brevo puts a link to a report file in each
 * info.import field that has rejected rows, and null otherwise.
 */
export function brevoProcessReport(id: string | number, json: unknown): BrevoProcessReport {
  const bag = (json && typeof json === 'object' ? json : {}) as { status?: unknown; info?: { import?: Record<string, unknown> } }
  const status = typeof bag.status === 'string' ? bag.status : 'unknown'
  const issues: string[] = []
  for (const [key, value] of Object.entries(bag.info?.import ?? {})) {
    if (value === null || value === undefined || value === '' || value === 0) continue
    const label = IMPORT_ISSUE_LABELS[key] ?? key
    issues.push(typeof value === 'string' && /^https?:/.test(value) ? `${label}: ${value}` : `${label}: ${JSON.stringify(value)}`)
  }
  return { id, status, issues }
}

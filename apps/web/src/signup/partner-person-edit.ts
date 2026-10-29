/**
 * Editing one „И аз“ person from /admin/iaz/$personId (client-safe: no DB, no mail). Data only;
 * МИР, section and withdrawal have their own actions. Names go through the rename transition, so a
 * numbered пълномощно goes back for signing.
 */
import { emailProblem, normalizeEmail, normalizePhone } from './partner-import'

export type PartnerEditable = {
  firstName: string
  middleName: string
  lastName: string
  email: string
  phone: string
  region: string
  municipality: string
  placeNote: string
}

export const PARTNER_EDIT_FIELDS: Array<{ key: keyof PartnerEditable; column: string; label: string; max: number }> = [
  { key: 'firstName', column: 'first_name', label: 'Име', max: 80 },
  { key: 'middleName', column: 'middle_name', label: 'Презиме', max: 80 },
  { key: 'lastName', column: 'last_name', label: 'Фамилия', max: 80 },
  { key: 'email', column: 'email', label: 'Имейл', max: 254 },
  { key: 'phone', column: 'phone', label: 'Телефон', max: 20 },
  { key: 'region', column: 'region_name', label: 'Област', max: 80 },
  { key: 'municipality', column: 'municipality_name', label: 'Община', max: 80 },
  { key: 'placeNote', column: 'place_note', label: 'Място (от „И аз“)', max: 300 },
]

const NAME_KEYS = new Set<keyof PartnerEditable>(['firstName', 'middleName', 'lastName'])

export function cleanPartnerEdit(input: Partial<Record<keyof PartnerEditable, unknown>>): PartnerEditable {
  const out = {} as PartnerEditable
  for (const field of PARTNER_EDIT_FIELDS) out[field.key] = String(input?.[field.key] ?? '').replace(/\s+/g, ' ').trim().slice(0, field.max)
  return out
}

export type PartnerEditChange = { key: keyof PartnerEditable; column: string; label: string; before: string; after: string }

/** What changes, or why not. Email lower-cased, phone as 0XXXXXXXXX; empty phone is allowed. */
export function planPartnerEdit(before: PartnerEditable, raw: PartnerEditable): { ok: true; changes: PartnerEditChange[]; namesChanged: boolean } | { ok: false; message: string } {
  const after: PartnerEditable = { ...raw, email: normalizeEmail(raw.email) }
  if (!after.firstName || !after.lastName) return { ok: false, message: 'Нужни са име и фамилия.' }
  const emailIssue = emailProblem(after.email)
  if (emailIssue) return { ok: false, message: `Имейл: ${emailIssue}.` }
  const phone = normalizePhone(after.phone)
  if (phone.problem) return { ok: false, message: `Телефон: ${phone.problem}.` }
  after.phone = phone.phone
  const changes = PARTNER_EDIT_FIELDS.filter((field) => (before[field.key] ?? '') !== after[field.key]).map((field) => ({
    key: field.key,
    column: field.column,
    label: field.label,
    before: before[field.key] ?? '',
    after: after[field.key],
  }))
  return { ok: true, changes, namesChanged: changes.some((change) => NAME_KEYS.has(change.key)) }
}

/** One UPDATE for the changed columns; ?1 updated_at, ?2 id, then the values in order. */
export function partnerEditSql(changes: PartnerEditChange[]) {
  return `UPDATE partner_people SET ${changes.map((change, index) => `${change.column} = ?${index + 3}`).join(', ')}, updated_at = ?1 WHERE id = ?2`
}

/**
 * The „Без имейл“ switch on a volunteer's page (/admin/signups/$personId). Staff can mark someone as
 * having no e-mail (the address becomes a …@tibroish.invalid stand-in, no-email.ts) or give an e-mail
 * to someone who had none. One signup_audit line each, with the address masked. Mail and Brevo are
 * not touched here: the caller cleans the old Brevo contact and numbers the person by МИР.
 */
import type { SignupD1 } from './db-core'
import { validEmail } from './model'
import { hasRealEmail, isPlaceholderEmail } from './no-email'
import { placeholderEmail } from './staff-add-volunteer'

export type PersonEmailInput = { id: string; email: string; noEmail: boolean }

export type PersonEmailResult =
  | { ok: true; changed: boolean; noEmail: boolean; email: string; previousEmail: string; message: string }
  | { ok: false; message: string }

export function parsePersonEmailInput(input: unknown): PersonEmailInput {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const noEmail = raw.noEmail === true
  return {
    id: String(raw.id ?? '').trim().slice(0, 80),
    email: noEmail ? '' : String(raw.email ?? '').trim().toLowerCase().slice(0, 160),
    noEmail,
  }
}

/** First problem with the input, in Bulgarian, or null. */
export function personEmailProblem(input: PersonEmailInput): string | null {
  if (!input.id) return 'Няма такъв човек.'
  if (input.noEmail) return null
  if (!input.email) return 'Попълни имейла или отбележи „Без имейл“.'
  if (!validEmail(input.email) || isPlaceholderEmail(input.email)) return 'Имейлът не е валиден.'
  return null
}

/** `a***@example.org`, or „без имейл“: what the audit line keeps. */
export function auditEmail(email: string | null | undefined) {
  if (!hasRealEmail(email)) return 'без имейл'
  const value = String(email).trim().toLowerCase()
  const at = value.indexOf('@')
  return `${value.slice(0, 1)}***@${value.slice(at + 1)}`
}

const IN_USE_SQL = `SELECT 'signup' AS kind FROM signups WHERE id != ?1 AND email = ?2 COLLATE NOCASE
  UNION ALL SELECT 'partner' FROM partner_people WHERE lower(trim(email)) = ?2 LIMIT 1`

export async function setSignupEmail(db: SignupD1, input: PersonEmailInput, actor: string, at = new Date()): Promise<PersonEmailResult> {
  const problem = personEmailProblem(input)
  if (problem) return { ok: false, message: problem }
  const row = await db.prepare(`SELECT id, email FROM signups WHERE id = ?`).bind(input.id).first<{ id: string; email: string }>()
  if (!row) return { ok: false, message: 'Няма такъв човек.' }
  const before = String(row.email ?? '')
  const wasNoEmail = !hasRealEmail(before)
  if (input.noEmail && wasNoEmail) return { ok: true, changed: false, noEmail: true, email: before, previousEmail: before, message: 'Вече е без имейл.' }
  if (!input.noEmail && before.trim().toLowerCase() === input.email) {
    return { ok: true, changed: false, noEmail: false, email: before, previousEmail: before, message: 'Имейлът е същият.' }
  }
  let email = input.email
  if (input.noEmail) {
    email = placeholderEmail()
    for (let attempt = 0; attempt < 3 && (await db.prepare(IN_USE_SQL).bind(input.id, email).first()); attempt += 1) email = placeholderEmail()
  } else if (await db.prepare(IN_USE_SQL).bind(input.id, email).first()) {
    return { ok: false, message: 'Този имейл вече е на друг запис (записване или „И аз“).' }
  }
  const now = at.toISOString()
  // No e-mail: no login either (session, pending change and code cleared); the Brevo mark is reset so a
  // later real address is sent fresh. A real address typed by staff counts as confirmed, as on „Добави доброволец“.
  const update = input.noEmail
    ? `UPDATE signups SET email = ?1, payload = json_set(payload, '$.email', ?1, '$.emailConfirmed', json('true')),
         email_confirmed = 1, session_token = NULL, pending_email = NULL, email_code = NULL,
         brevo_section_synced = NULL, brevo_section_synced_at = NULL, updated_at = ?2 WHERE id = ?3`
    : `UPDATE signups SET email = ?1, payload = json_set(payload, '$.email', ?1, '$.emailConfirmed', json('true')),
         email_confirmed = 1, pending_email = NULL, email_code = NULL,
         brevo_section_synced = NULL, brevo_section_synced_at = NULL, updated_at = ?2 WHERE id = ?3`
  try {
    await db.batch([
      db.prepare(update).bind(email, now, input.id),
      db
        .prepare(`INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at) VALUES (?, ?, ?, 'email', ?, ?, ?)`)
        .bind(crypto.randomUUID(), input.id, actor, auditEmail(before), auditEmail(email), now),
    ])
  } catch (error) {
    console.warn('setSignupEmail', error instanceof Error ? error.message : error)
    return { ok: false, message: 'Имейлът не се записа (може би вече е на друг запис). Опитай пак.' }
  }
  return {
    ok: true,
    changed: true,
    noEmail: input.noEmail,
    email,
    previousEmail: before,
    message: input.noEmail
      ? 'Отбелязан е „Без имейл“: няма писма и няма Brevo; пълномощното е по МИР.'
      : 'Имейлът е записан. Писмо не е изпратено.',
  }
}

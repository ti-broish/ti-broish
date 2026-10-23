/**
 * Who may write which signup row from the volunteer form (saveSignup).
 *
 * A browser writes only the row its own tb_session points at. Typing an e-mail that already has a
 * record never takes that record over: the person proves the address with the six-digit code
 * (checkEmailCode or /vhod), which is what puts that record's session in this browser. The same
 * tb_session is also the staff login, so handing it out without the code would hand out /admin.
 */

export interface SessionRow {
  id: string
  email: string
  session_token: string | null
  imported: number | null
  email_confirmed: number | null
  pending_email?: string | null
}

export interface EmailRow {
  id: string
  session_token: string | null
  imported: number | null
  email_confirmed: number | null
}

export const SIGN_IN_MESSAGE = 'Този имейл вече е записан. Потвърди го с кода от писмото или влез през /vhod, за да продължиш.'
export const PENDING_LETTER_MESSAGE = 'Този имейл чака потвърждение от писмото.'
export const OTHER_RECORD_MESSAGE = 'Този имейл вече е на друго записване. Влез с него през /vhod.'

export function sessionEmailMessage(sessionEmail: string) {
  return `Този браузър е влязъл като ${sessionEmail}. За друг човек избери „Запиши друг човек“ в началото на записването.`
}

export type SaveRefusal = 'signin' | 'pending-letter' | 'other-record' | 'session-email'

export type SaveDecision =
  | { kind: 'refuse'; reason: SaveRefusal; message: string }
  | { kind: 'new' }
  /** The browser's own row. `email` is what the row keeps; `renameFrom` is set when an unconfirmed row takes the typed address. */
  | { kind: 'own'; row: SessionRow; email: string; emailConfirmed: boolean; renameFrom?: string }

const norm = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

export function saveDecision(typedEmail: string, bySession: SessionRow | null, byEmail: EmailRow | null): SaveDecision {
  const typed = norm(typedEmail)
  if (bySession) {
    const own = norm(bySession.email)
    const confirmed = bySession.email_confirmed === 1
    if (byEmail && byEmail.id !== bySession.id) {
      if (byEmail.imported && !byEmail.email_confirmed) return { kind: 'refuse', reason: 'pending-letter', message: PENDING_LETTER_MESSAGE }
      return { kind: 'refuse', reason: 'other-record', message: OTHER_RECORD_MESSAGE }
    }
    if (typed === own) return { kind: 'own', row: bySession, email: own, emailConfirmed: confirmed }
    // An e-mail change waiting for its code: the row keeps the old address until checkEmailCode.
    if (typed && typed === norm(bySession.pending_email)) return { kind: 'own', row: bySession, email: own, emailConfirmed: confirmed }
    // Still typing the address of a row nobody has confirmed yet: the row follows what is typed.
    if (!confirmed && !bySession.imported) return { kind: 'own', row: bySession, email: typed, emailConfirmed: false, renameFrom: own }
    return { kind: 'refuse', reason: 'session-email', message: sessionEmailMessage(bySession.email) }
  }
  if (byEmail) {
    if (byEmail.imported && !byEmail.email_confirmed) return { kind: 'refuse', reason: 'pending-letter', message: PENDING_LETTER_MESSAGE }
    return { kind: 'refuse', reason: 'signin', message: SIGN_IN_MESSAGE }
  }
  return { kind: 'new' }
}

export interface Identity {
  name: string
  email: string
  phone: string
  egn: string
}

/** egn_last4: the audit line holds only the masked ЕГН (a raw „egn“ line is never shown). */
export type IdentityField = 'name' | 'email' | 'phone' | 'egn_last4'

/** ЕГН in an audit line: only the last four digits. */
export function maskEgn(egn: string) {
  const digits = egn.trim()
  if (!digits) return 'няма'
  return `••••••${digits.slice(-4)}`
}

export function identityOf(payload: { firstName?: string; middleName?: string; lastName?: string; email?: string; phone?: string }, egn: string): Identity {
  return {
    name: [payload.firstName, payload.middleName, payload.lastName].map((part) => (part ?? '').trim()).filter(Boolean).join(' '),
    email: norm(payload.email),
    phone: (payload.phone ?? '').trim(),
    egn: (egn ?? '').trim(),
  }
}

/** One audit change per identity field that differs. The ЕГН is masked on both sides. */
export function identityChanges(before: Identity, after: Identity): { field: IdentityField; before: string; after: string }[] {
  const changes: { field: IdentityField; before: string; after: string }[] = []
  if (before.name !== after.name) changes.push({ field: 'name', before: before.name, after: after.name })
  if (before.email !== after.email) changes.push({ field: 'email', before: before.email, after: after.email })
  if (before.phone !== after.phone) changes.push({ field: 'phone', before: before.phone, after: after.phone })
  if (before.egn !== after.egn) changes.push({ field: 'egn_last4', before: maskEgn(before.egn), after: maskEgn(after.egn) })
  return changes
}

export const IDENTITY_AUDIT_SQL = `INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`

/** signup_audit.actor for a change the volunteer made from their own session. */
export function selfActor(email: string) {
  return `self:${norm(email)}`
}

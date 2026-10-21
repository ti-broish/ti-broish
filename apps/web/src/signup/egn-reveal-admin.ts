import { getCookie } from '@tanstack/react-start/server'
import { auditLines } from './admin-audit'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { httpStatusForStaffDenial, personIdOk, type StaffDenialState } from './designation-preview'
import { EGN_NO_STORE_HEADERS, EGN_REVEAL_AFTER, EGN_REVEAL_FIELD, egnDigits, sameOriginReveal } from './egn-reveal'
import { isPartnerPersonId } from './partner-people-sql'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: StaffDenialState; email: string; message: string }

async function gate(action: StaffAction): Promise<{ ok: true; db: Database; email: string; role: StaffRole } | Denial> {
  const db = await signupDatabase()
  if (!db) return { ok: false, state: 'nodb', email: '', message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{ email: string; email_confirmed: number }>()
  if (!session) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  if (!session.email_confirmed) return { ok: false, state: 'unconfirmed', email, message: 'Потвърди имейла, за да влезеш в екипа.' }
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role) return { ok: false, state: 'forbidden', email, message: 'Този имейл не е поканен в екипа.' }
  if (!roleAllows(role, action)) return { ok: false, state: 'forbidden', email, message: 'Само админ може да вижда ЕГН.' }
  return { ok: true, db, email, role }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: EGN_NO_STORE_HEADERS })
}

/**
 * POST /admin/signups/:id/egn. Admins only. Writes one signup_audit row (who, when; never the
 * number) before answering, so a reveal that is not audited is not shown. Never cached.
 */
export async function serveEgnReveal(request: Request, personId: string): Promise<Response> {
  if (!sameOriginReveal(request.headers, request.url)) return json({ ok: false, message: 'Отказано.' }, 403)
  const access = await gate('revealEgn')
  if (!access.ok) return json({ ok: false, message: access.message }, httpStatusForStaffDenial(access.state))
  if (!personIdOk(personId)) return json({ ok: false, message: 'Няма такъв човек.' }, 404)
  const row = await access.db
    .prepare(isPartnerPersonId(personId) ? 'SELECT id, egn FROM partner_people WHERE id = ?' : 'SELECT id, egn FROM signups WHERE id = ?')
    .bind(personId)
    .first<{ id: string; egn: string | null }>()
  if (!row) return json({ ok: false, message: 'Няма такъв човек.' }, 404)
  const egn = egnDigits(row.egn)
  if (!egn) return json({ ok: false, message: 'Няма ЕГН.' }, 404)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    await access.db
      .prepare(`INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, row.id, access.email, EGN_REVEAL_FIELD, '', EGN_REVEAL_AFTER, now)
      .run()
  } catch {
    return json({ ok: false, message: 'Не успяхме да запишем прегледа, затова ЕГН не се показва.' }, 500)
  }
  const [audit] = auditLines([{ id, actor: access.email, field: EGN_REVEAL_FIELD, before_text: '', after_text: EGN_REVEAL_AFTER, created_at: now }])
  return json({ ok: true, egn, audit }, 200)
}

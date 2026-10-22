import { getCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import {
  contentDisposition,
  httpStatusForStaffDenial,
  personIdOk,
  previewDesignationPdf,
  previewNumber,
  previewPersonInput,
  type StaffDenialState,
} from './designation-preview'
import { todayInSofia } from './designation-config'
import { PARTNER_DESIGNATION_ROW_SQL, isPartnerPersonId } from './partner-people-sql'
import { SIGNUP_DESIGNATION_SECTION_SQL } from './designation-section-sql'
import { registerWorkerDesignationFonts } from './designation-fonts-worker'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

registerWorkerDesignationFonts()

type Database = SignupD1
type Denial = { ok: false; state: StaffDenialState; email: string; message: string }

interface StoredDesignationRow {
  id: string
  payload: string
  egn: string | null
  published_section: string | null
  section_place: string | null
  designation_number: number | string | null
  designation_issued_at: string | null
}

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
  if (!roleAllows(role, action)) return { ok: false, state: 'forbidden', email, message: 'Тази роля няма това право.' }
  return { ok: true, db, email, role }
}

function workerEnv(): Record<string, string | undefined> {
  return env as unknown as Record<string, string | undefined>
}

export async function serveDesignationPdf(personId: string): Promise<Response> {
  const access = await gate('view')
  if (!access.ok) {
    return new Response(access.message, {
      status: httpStatusForStaffDenial(access.state),
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  if (!personIdOk(personId)) {
    return new Response('Няма такъв човек.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  const row = await access.db
    .prepare(
      isPartnerPersonId(personId)
        ? PARTNER_DESIGNATION_ROW_SQL
        : `SELECT id, payload, egn,
        ${SIGNUP_DESIGNATION_SECTION_SQL} AS published_section,
        COALESCE(NULLIF(section_place, ''), json_extract(payload, '$.place.sectionPlace'), '') AS section_place,
        designation_number, designation_issued_at
        FROM signups WHERE id = ?`,
    )
    .bind(personId)
    .first<StoredDesignationRow>()
  if (!row) {
    return new Response('Няма такъв човек.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  const person = previewPersonInput(row)
  if (!person.sectionCode) {
    return new Response('Няма назначена секция за това пълномощно.', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  const { bytes, filename } = await previewDesignationPdf({
    person,
    number: previewNumber(row.designation_number),
    issuedOn: (row.designation_issued_at ?? '').trim() || todayInSofia(),
    env: workerEnv(),
  })
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Response(copy.buffer, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': contentDisposition(filename),
      'cache-control': 'private, no-store',
    },
  })
}

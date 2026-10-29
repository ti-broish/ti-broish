import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import {
  IAZ_PARTNER,
  IMPORTED_EGNS_SQL,
  PARTNER_IMPORT_MAX_BYTES,
  PARTNER_IMPORT_MAX_ROWS,
  PARTNER_MAPPING,
  SIGNUP_OVERLAP_SQL,
  lookupKeys,
  parsePartnerCsv,
  partnerImportStatements,
  planPartnerImport,
  planSummary,
  previewRows,
  type PartnerRawRow,
  type SignupOverlap,
} from './partner-import'
import { isPartnerPersonId } from './partner-people-sql'
import { ELECTION_DISTRICTS } from './designation-config'
import { PARTNER_WITHDRAW_AUDIT_SQL, PARTNER_WITHDRAW_REASON_MAX, PARTNER_WITHDRAW_SQL } from './designation-audit-sql'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'
import { applyRenameTransition, fullName, namesChanged, renameMessage } from './designation-rename'
import { cleanPartnerEdit, partnerEditSql, planPartnerEdit, type PartnerEditable } from './partner-person-edit'

// No mail, Brevo or confirm-link code is imported here on purpose: the partner import is silent,
// and it writes only partner_people, never signups.

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

const LOOKUP_CHUNK = 40
const WRITE_CHUNK = 50

/** ЕГН already imported for the partner, and signups sharing an email or ЕГН. Chunked under the D1 bind limit. */
export async function lookupForPartnerRows(db: Database, rows: PartnerRawRow[], partner = IAZ_PARTNER) {
  const { emails, egns } = lookupKeys(rows)
  const imported = new Set<string>()
  const signups: SignupOverlap[] = []
  for (let start = 0; start < Math.max(emails.length, egns.length); start += LOOKUP_CHUNK) {
    const emailPart = emails.slice(start, start + LOOKUP_CHUNK)
    const egnPart = egns.slice(start, start + LOOKUP_CHUNK)
    if (egnPart.length) {
      const found = await db.prepare(IMPORTED_EGNS_SQL(egnPart.length)).bind(partner, ...egnPart).all<{ egn: string }>()
      for (const row of found.results ?? []) imported.add(row.egn)
    }
    if (emailPart.length || egnPart.length) {
      const found = await db.prepare(SIGNUP_OVERLAP_SQL(emailPart.length, egnPart.length)).bind(...emailPart, ...egnPart).all<SignupOverlap>()
      signups.push(...(found.results ?? []))
    }
  }
  return { imported: [...imported], signups }
}

export const adminPartnerImport = createServerFn({ method: 'POST' })
  .validator((input: { csv: string; commit?: boolean }) => ({ csv: String(input?.csv ?? ''), commit: input?.commit === true }))
  .handler(async ({ data }) => {
    if (data.csv.length > PARTNER_IMPORT_MAX_BYTES) return { ok: false as const, message: 'Файлът е твърде голям.' }
    const access = await gate('edit')
    if (!access.ok) return access
    const parsed = parsePartnerCsv(data.csv)
    if (parsed.errors.length) return { ok: false as const, message: parsed.errors[0]! }
    if (parsed.rows.length === 0) return { ok: false as const, message: 'Във файла няма редове.' }
    if (parsed.rows.length > PARTNER_IMPORT_MAX_ROWS) return { ok: false as const, message: `Най-много ${PARTNER_IMPORT_MAX_ROWS} реда наведнъж.` }
    const db = access.db
    const found = await lookupForPartnerRows(db, parsed.rows)
    const plan = planPartnerImport(parsed.rows, found.imported, found.signups, IAZ_PARTNER)
    let written = 0
    if (data.commit) {
      const statements = partnerImportStatements(plan, new Date().toISOString())
      for (let start = 0; start < statements.length; start += WRITE_CHUNK) {
        const chunk = statements.slice(start, start + WRITE_CHUNK).map((statement) => db.prepare(statement.sql).bind(...statement.params))
        // One batch is one transaction.
        await db.batch(chunk)
        written += chunk.length
      }
    }
    return {
      ok: true as const,
      committed: data.commit,
      written,
      counts: plan.counts,
      total: plan.total,
      summary: planSummary(plan),
      mapping: PARTNER_MAPPING,
      rows: previewRows(plan),
    }
  })

/** Staff pick the МИР when the file did not give one (София без район). Fixed once the person has a number. */
export const adminPartnerSetMir = createServerFn({ method: 'POST' })
  .validator((input: { id: string; mir: string }) => ({ id: String(input?.id ?? ''), mir: String(input?.mir ?? '').trim() }))
  .handler(async ({ data }) => {
    if (!isPartnerPersonId(data.id)) return { ok: false as const, message: 'Няма такъв човек от „И аз“.' }
    const mir = data.mir.padStart(2, '0')
    if (!/^\d{2}$/.test(mir) || !ELECTION_DISTRICTS[mir]) return { ok: false as const, message: 'Избери МИР.' }
    const access = await gate('edit')
    if (!access.ok) return access
    const result = (await access.db
      .prepare('UPDATE partner_people SET designation_mir = ?, updated_at = ? WHERE id = ? AND designation_number IS NULL')
      .bind(mir, new Date().toISOString(), data.id)
      .run()) as { meta?: { changes?: number } }
    if (!result?.meta?.changes) return { ok: false as const, message: 'МИР не се сменя след номериране.' }
    return { ok: true as const, message: `МИР ${mir} е записан.` }
  })

/**
 * Withdraw one „И аз“ пълномощно (admins). Number and МИР stay: history, and numbers are never
 * reused. A withdrawn row is never numbered, zipped for signing, put in a signed wave or a „call the
 * РИК“ task. Drive files are left as they are. Writes one audit line.
 */
export const adminPartnerWithdraw = createServerFn({ method: 'POST' })
  .validator((input: { id: string; reason: string }) => ({
    id: String(input?.id ?? ''),
    reason: String(input?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, PARTNER_WITHDRAW_REASON_MAX),
  }))
  .handler(async ({ data }) => {
    if (!isPartnerPersonId(data.id)) return { ok: false as const, message: 'Няма такъв човек от „И аз“.' }
    if (!data.reason) return { ok: false as const, message: 'Напиши причина за оттеглянето.' }
    const access = await gate('publish')
    if (!access.ok) return access
    const at = new Date().toISOString()
    await access.db.batch([
      access.db.prepare(PARTNER_WITHDRAW_SQL).bind(at, access.email, data.reason, data.id),
      access.db.prepare(PARTNER_WITHDRAW_AUDIT_SQL).bind(crypto.randomUUID(), access.email, at, data.id),
    ])
    const row = await access.db
      .prepare('SELECT withdrawn_at, designation_number, designation_mir FROM partner_people WHERE id = ?')
      .bind(data.id)
      .first<{ withdrawn_at: string | null; designation_number: number | null; designation_mir: string | null }>()
    if (!row) return { ok: false as const, message: 'Няма такъв човек от „И аз“.' }
    if (row.withdrawn_at !== at) return { ok: false as const, message: 'Това пълномощно вече е оттеглено.' }
    const which = row.designation_number != null ? ` № ${row.designation_number} (МИР ${row.designation_mir ?? ''})` : ''
    return {
      ok: true as const,
      message: `Пълномощното${which} е оттеглено. Номерът остава зает; файлът в Drive не е пипан. Поискай от РИК да го анулира, ако вече е подадено.`,
    }
  })

const clipName = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * New names for one „И аз“ person (as on the identity card). Number and МИР stay; an existing
 * пълномощно goes back for signing, and a РИК correction is opened if it already went out.
 */
export const adminPartnerRename = createServerFn({ method: 'POST' })
  .validator((input: { id: string; firstName: string; middleName: string; lastName: string }) => ({
    id: String(input?.id ?? ''),
    firstName: clipName(input?.firstName),
    middleName: clipName(input?.middleName),
    lastName: clipName(input?.lastName),
  }))
  .handler(async ({ data }) => {
    if (!isPartnerPersonId(data.id)) return { ok: false as const, message: 'Няма такъв човек от „И аз“.' }
    if (!data.firstName || !data.lastName) return { ok: false as const, message: 'Нужни са име и фамилия.' }
    const access = await gate('edit')
    if (!access.ok) return access
    const row = await access.db
      .prepare('SELECT first_name, middle_name, last_name FROM partner_people WHERE id = ?')
      .bind(data.id)
      .first<{ first_name: string; middle_name: string; last_name: string }>()
    if (!row) return { ok: false as const, message: 'Няма такъв човек от „И аз“.' }
    const before = { firstName: row.first_name ?? '', middleName: row.middle_name ?? '', lastName: row.last_name ?? '' }
    const after = { firstName: data.firstName, middleName: data.middleName, lastName: data.lastName }
    if (!namesChanged(before, after)) return { ok: true as const, message: 'Имената са същите.' }
    const now = new Date().toISOString()
    await access.db
      .prepare('UPDATE partner_people SET first_name = ?, middle_name = ?, last_name = ?, updated_at = ? WHERE id = ?')
      .bind(after.firstName, after.middleName, after.lastName, now, data.id)
      .run()
    const result = await applyRenameTransition(access.db, { table: 'partner_people', id: data.id, before, after, actor: access.email, now })
    return { ok: true as const, message: `Имената са сменени на „${fullName(after)}“.${renameMessage(result, result.number, result.mir)}` }
  })

/**
 * Data of one „И аз“ person (/admin/iaz/$personId): names, e-mail, phone, place. One audit line per
 * changed field (signup_audit, keyed by the pp- id). Names: number and МИР stay, the пълномощно goes
 * back for signing. Nothing is sent: „И аз“ people get no mail and never reach our Brevo.
 */
export const adminPartnerUpdate = createServerFn({ method: 'POST' })
  .validator((input: { id: string } & Partial<Record<keyof PartnerEditable, string>>) => ({ id: String(input?.id ?? ''), fields: cleanPartnerEdit(input ?? {}) }))
  .handler(async ({ data }) => {
    if (!isPartnerPersonId(data.id)) return { ok: false as const, message: 'Няма такъв човек от „И аз“.' }
    const access = await gate('edit')
    if (!access.ok) return access
    const row = await access.db
      .prepare(
        `SELECT first_name, middle_name, last_name, email, phone, region_name, municipality_name, place_note, withdrawn_at
         FROM partner_people WHERE id = ?`,
      )
      .bind(data.id)
      .first<Record<string, string | null>>()
    if (!row) return { ok: false as const, message: 'Няма такъв човек от „И аз“.' }
    if (row.withdrawn_at) return { ok: false as const, message: 'Пълномощното е оттеглено; данните не се пипат.' }
    const before: PartnerEditable = {
      firstName: row.first_name ?? '',
      middleName: row.middle_name ?? '',
      lastName: row.last_name ?? '',
      email: row.email ?? '',
      phone: row.phone ?? '',
      region: row.region_name ?? '',
      municipality: row.municipality_name ?? '',
      placeNote: row.place_note ?? '',
    }
    const plan = planPartnerEdit(before, data.fields)
    if (!plan.ok) return { ok: false as const, message: plan.message }
    if (plan.changes.length === 0) return { ok: true as const, changed: 0, message: 'Няма промени.' }
    const now = new Date().toISOString()
    await access.db.batch([
      access.db.prepare(partnerEditSql(plan.changes)).bind(now, data.id, ...plan.changes.map((change) => change.after)),
      ...plan.changes.map((change) =>
        access.db
          .prepare('INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), data.id, access.email, `partner_${change.key}`, change.before, change.after, now),
      ),
    ])
    let tail = ''
    if (plan.namesChanged) {
      const names = (value: PartnerEditable) => ({ firstName: value.firstName, middleName: value.middleName, lastName: value.lastName })
      const after = { ...before, ...Object.fromEntries(plan.changes.map((change) => [change.key, change.after])) } as PartnerEditable
      const result = await applyRenameTransition(access.db, { table: 'partner_people', id: data.id, before: names(before), after: names(after), actor: access.email, now })
      tail = renameMessage(result, result.number, result.mir)
    }
    return { ok: true as const, changed: plan.changes.length, message: `Записано: ${plan.changes.map((change) => change.label).join(', ')}.${tail}` }
  })

/** Last changes to one „И аз“ person, newest first. */
export const adminPartnerHistory = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => ({ id: String(input?.id ?? '') }))
  .handler(async ({ data }) => {
    if (!isPartnerPersonId(data.id)) return { ok: false as const, message: 'Няма такъв човек от „И аз“.' }
    const access = await gate('view')
    if (!access.ok) return access
    const rows = await access.db
      .prepare('SELECT field, before_text, after_text, actor, created_at FROM signup_audit WHERE signup_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(data.id)
      .all<{ field: string; before_text: string; after_text: string; actor: string; created_at: string }>()
    return {
      ok: true as const,
      rows: (rows.results ?? []).map((row) => ({ field: row.field, before: row.before_text, after: row.after_text, actor: row.actor, at: row.created_at })),
    }
  })

async function gate(action: StaffAction): Promise<{ ok: true; db: Database; email: string; role: StaffRole } | Denial> {
  const db = await signupDatabase()
  if (!db) return { ok: false, state: 'nodb', email: '', message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const session = await db
    .prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?')
    .bind(token)
    .first<{ email: string; email_confirmed: number }>()
  if (!session) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  if (!session.email_confirmed) return { ok: false, state: 'unconfirmed', email, message: 'Потвърди имейла, за да влезеш в екипа.' }
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role) return { ok: false, state: 'forbidden', email, message: 'Този имейл не е поканен в екипа.' }
  if (!roleAllows(role, action)) return { ok: false, state: 'forbidden', email, message: 'Тази роля няма това право.' }
  return { ok: true, db, email, role }
}

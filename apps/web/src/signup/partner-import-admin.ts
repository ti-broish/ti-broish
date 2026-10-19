import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import {
  EXISTING_SIGNUPS_SQL,
  IAZ_PARTNER,
  PARTNER_IMPORT_MAX_BYTES,
  PARTNER_IMPORT_MAX_ROWS,
  PARTNER_MAPPING,
  lookupKeys,
  parsePartnerCsv,
  partnerImportStatements,
  planPartnerImport,
  planSummary,
  previewRows,
  type ExistingSignup,
  type PartnerRawRow,
} from './partner-import'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

// No mail, Brevo or confirm-link code is imported here on purpose: the partner import is silent.

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

const LOOKUP_CHUNK = 40
const WRITE_CHUNK = 50

/** Signups that share an email or ЕГН with the file. Chunked under the D1 bind limit. */
export async function existingForPartnerRows(db: Database, rows: PartnerRawRow[]): Promise<ExistingSignup[]> {
  const { emails, egns } = lookupKeys(rows)
  const found = new Map<string, ExistingSignup>()
  for (let start = 0; start < Math.max(emails.length, egns.length); start += LOOKUP_CHUNK) {
    const emailPart = emails.slice(start, start + LOOKUP_CHUNK)
    const egnPart = egns.slice(start, start + LOOKUP_CHUNK)
    if (!emailPart.length && !egnPart.length) continue
    const result = await db
      .prepare(EXISTING_SIGNUPS_SQL(emailPart.length, egnPart.length))
      .bind(...emailPart, ...egnPart)
      .all<ExistingSignup>()
    for (const row of result.results ?? []) found.set(row.id, row)
  }
  return [...found.values()]
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
    const plan = planPartnerImport(parsed.rows, await existingForPartnerRows(db, parsed.rows), IAZ_PARTNER)
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

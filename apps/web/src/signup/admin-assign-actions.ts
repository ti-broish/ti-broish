import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { normalizeSection, rosterWhere, type RosterView } from './admin-csv'
import { publishBlocked, validateAssignment, warningSummary, type AssignWarning, type DuplicateOwner } from './admin-assign'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

const VIEWS: RosterView[] = ['all', 'assigned', 'unassigned', 'draft', 'abroad', 'mir']

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

function viewOf(value: string): RosterView {
  return VIEWS.includes(value as RosterView) ? (value as RosterView) : 'all'
}

function bound(db: Database, sql: string, binds: unknown[]) {
  const statement = db.prepare(sql)
  return binds.length > 0 ? statement.bind(...binds) : statement
}

export const adminDraft = createServerFn({ method: 'POST' })
  .validator((input: { id: string; section: string }) => input)
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const section = normalizeSection(data.section).slice(0, 32)
    const person = await db
      .prepare(`SELECT id, email, COALESCE(mir_code, '') AS mir FROM signups WHERE id = ?`)
      .bind(data.id)
      .first<{ id: string; email: string; mir: string }>()
    if (!person) return { ok: false as const, message: 'Няма такова записване.' }
    const warnings = section ? await assignmentWarnings(db, section, person.id, person.mir) : []
    await db.prepare(`UPDATE signups SET draft_section = NULLIF(?, ''), updated_at = ? WHERE id = ?`).bind(section, new Date().toISOString(), data.id).run()
    return {
      ok: true as const,
      warning: warningSummary(warnings),
      warnings,
      blockedOnPublish: publishBlocked(warnings),
    }
  })

export const adminPublish = createServerFn({ method: 'POST' })
  .validator((input: { view: string; mir: string }) => input)
  .handler(async ({ data }) => {
    const access = await gate('publish')
    if (!access.ok) return access
    const db = access.db
    const filter = rosterWhere(viewOf(data.view), data.mir)
    if ('error' in filter) return { ok: false as const, message: filter.error }
    const pending = `COALESCE(draft_section, '') != '' AND COALESCE(draft_section, '') != COALESCE(published_section, '')`
    const rows = await bound(
      db,
      `SELECT id, email, COALESCE(mir_code, '') AS mir, COALESCE(draft_section, '') AS draft_section
       FROM signups WHERE (${filter.clause}) AND ${pending}`,
      filter.binds,
    ).all<{ id: string; email: string; mir: string; draft_section: string }>()
    const now = new Date().toISOString()
    let published = 0
    const blocked: Array<{ email: string; section: string; warning: string }> = []
    for (const row of rows.results ?? []) {
      const section = normalizeSection(row.draft_section)
      const warnings = await assignmentWarnings(db, section, row.id, row.mir)
      if (publishBlocked(warnings)) {
        blocked.push({ email: row.email, section, warning: warningSummary(warnings) })
        continue
      }
      await db
        .prepare(`UPDATE signups SET published_section = draft_section, published_at = ?, updated_at = ? WHERE id = ?`)
        .bind(now, now, row.id)
        .run()
      published += 1
    }
    return { ok: true as const, published, blocked }
  })

async function assignmentWarnings(db: Database, section: string, personId: string, personMir: string): Promise<AssignWarning[]> {
  const taken = await db
    .prepare('SELECT organisation FROM taken_sections WHERE section_code = ?')
    .bind(section)
    .first<{ organisation: string }>()
  const duplicate = await findDuplicateOwner(db, section, personId)
  return validateAssignment({
    section,
    personId,
    personMir,
    takenOrg: taken?.organisation ?? null,
    duplicate,
  })
}

async function findDuplicateOwner(db: Database, section: string, personId: string): Promise<DuplicateOwner | null> {
  const published = await db
    .prepare(
      `SELECT id, email FROM signups
       WHERE id != ? AND COALESCE(withdrawn, 0) = 0 AND COALESCE(published_section, '') = ?
       LIMIT 1`,
    )
    .bind(personId, section)
    .first<{ id: string; email: string }>()
  if (published) return { id: published.id, email: published.email, kind: 'published' }
  const draft = await db
    .prepare(
      `SELECT id, email FROM signups
       WHERE id != ? AND COALESCE(withdrawn, 0) = 0 AND COALESCE(draft_section, '') = ?
       LIMIT 1`,
    )
    .bind(personId, section)
    .first<{ id: string; email: string }>()
  if (draft) return { id: draft.id, email: draft.email, kind: 'draft' }
  return null
}



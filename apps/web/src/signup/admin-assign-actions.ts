import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { distributionWhere, normalizeSection, type RosterView } from './admin-csv'
import { PERSON_REACH_COLUMNS, personReachFrom, publishBlocked, validateAssignment, warningSummary, type AssignWarning, type DuplicateOwner, type PersonReach } from './admin-assign'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'
import { reservedCode, reservedMessage } from './reserved-sections'
import { reservedOrgOf } from './reserved-sections-db'
import { isReservedAbort } from './reserved-sections-sql'
import { isSectionHeldAbort } from './partner-people-sql'
import { withPickedIds } from './section-state'

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
      .prepare(`SELECT id, email, ${PERSON_REACH_COLUMNS} FROM signups WHERE id = ?`)
      .bind(data.id)
      .first<{ id: string; email: string; mir: string; region: string; radius: string; distant_region_codes: string; travel_municipalities: string }>()
    if (!person) return { ok: false as const, message: 'Няма такова записване.' }
    // Reserved by another organisation: refuse, do not save a draft that could never be published.
    const reservedBy = section ? await reservedOrgOf(db, section) : null
    if (reservedBy) return { ok: false as const, reserved: reservedBy, message: reservedMessage(reservedCode(section) || section, reservedBy) }
    const warnings = section ? await assignmentWarnings(db, section, person.id, personReachFrom(person)) : []
    try {
      await db
      .prepare(
        `UPDATE signups
         SET draft_section = NULLIF(?, ''),
             draft_locked = CASE WHEN TRIM(?) = '' THEN 0 ELSE 1 END,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(section, section, new Date().toISOString(), data.id)
      .run()
    } catch (error) {
      if (isReservedAbort(error)) return { ok: false as const, reserved: '', message: `Секция ${section} е резервирана от друга организация.` }
      throw error
    }
    return {
      ok: true as const,
      warning: warningSummary(warnings),
      warnings,
      blockedOnPublish: publishBlocked(warnings),
    }
  })

export const adminPublish = createServerFn({ method: 'POST' })
  .validator((input: { view: string; mir: string; ids?: string[] }) => input)
  .handler(async ({ data }) => {
    const access = await gate('publish')
    if (!access.ok) return access
    const db = access.db
    // ids: „Публикувай“ on a row and „Публикувай избраните“. Same no-email path as the whole view.
    const filter = withPickedIds(distributionWhere(viewOf(data.view), data.mir), data.ids)
    if ('error' in filter) return { ok: false as const, message: filter.error }
    const pending = `COALESCE(draft_section, '') != '' AND COALESCE(draft_section, '') != COALESCE(published_section, '')`
    const rows = await bound(
      db,
      `SELECT id, email, ${PERSON_REACH_COLUMNS}, COALESCE(draft_section, '') AS draft_section
       FROM signups WHERE (${filter.clause}) AND ${pending}`,
      filter.binds,
    ).all<{ id: string; email: string; mir: string; region: string; radius: string; distant_region_codes: string; travel_municipalities: string; draft_section: string }>()
    const now = new Date().toISOString()
    let published = 0
    const blocked: Array<{ email: string; section: string; warning: string }> = []
    for (const row of rows.results ?? []) {
      const section = normalizeSection(row.draft_section)
      const warnings = await assignmentWarnings(db, section, row.id, personReachFrom(row))
      if (publishBlocked(warnings)) {
        blocked.push({ email: row.email, section, warning: warningSummary(warnings) })
        continue
      }
      try {
        await db
          .prepare(`UPDATE signups SET published_section = draft_section, published_at = ?, updated_at = ? WHERE id = ?`)
          .bind(now, now, row.id)
          .run()
      } catch (error) {
        if (!isReservedAbort(error) && !isSectionHeldAbort(error)) throw error
        blocked.push({ email: row.email, section, warning: isReservedAbort(error) ? `Секция ${section} е резервирана от друга организация.` : `Секция ${section} вече е заета.` })
        continue
      }
      published += 1
    }
    return { ok: true as const, published, blocked }
  })

async function assignmentWarnings(db: Database, section: string, personId: string, reach: PersonReach): Promise<AssignWarning[]> {
  const takenOrg = await reservedOrgOf(db, section)
  const duplicate = await findDuplicateOwner(db, section, personId)
  return validateAssignment({
    section,
    personId,
    personMir: reach.mir,
    reach,
    takenOrg,
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



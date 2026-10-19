import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import {
  coverageState,
  parsePriorityCsv,
  priorityCode,
  sortForAssignment,
  summarizePriorityCoverage,
  type PriorityCoverageState,
} from './priority-sections'
import { PRIORITY_SECTIONS_INSERT } from './priority-sections-sql'
import { isSpecialBulgariaSection } from './stationary-sections'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

export interface PrioritySectionView {
  sectionCode: string
  town: string
  municipality: string
  oblast: string
  r: number | null
  level: string
  state: PriorityCoverageState
}

/** Replace-all upload of the domestic priority CSV. Drafts, published sections and mail are untouched. */
export const adminImportPrioritySections = createServerFn({ method: 'POST' })
  .validator((input: { csv: string }) => input)
  .handler(async ({ data }) => {
    if (typeof data.csv !== 'string' || data.csv.length > 3_000_000) return { ok: false as const, message: 'Файлът е твърде голям.' }
    const access = await gate('edit')
    if (!access.ok) return access
    const parsed = parsePriorityCsv(data.csv)
    if (parsed.rows.length === 0) {
      return { ok: false as const, message: parsed.errors[0] ?? 'Няма валидни редове.', errors: parsed.errors.slice(0, 12) }
    }
    const db = access.db
    const now = new Date().toISOString()
    const inserts = parsed.rows.map((row) =>
      db.prepare(PRIORITY_SECTIONS_INSERT).bind(row.sectionCode, row.town, row.municipality, row.oblast, row.r, row.level, JSON.stringify(row.components), now),
    )
    // One batch is one transaction: a failed re-upload keeps the previous list.
    await db.batch([db.prepare('DELETE FROM priority_sections'), ...inserts])
    const unknown = parsed.rows.filter((row) => isSpecialBulgariaSection(row.sectionCode)).map((row) => row.sectionCode)
    const parts = [`Записани са ${parsed.rows.length} приоритетни секции`]
    if (parsed.rejected) parts.push(`отхвърлени ${parsed.rejected}`)
    if (parsed.duplicates) parts.push(`повторени ${parsed.duplicates}`)
    if (unknown.length) parts.push(`извън списъка на ЦИК: ${unknown.length}`)
    return {
      ok: true as const,
      imported: parsed.rows.length,
      rejected: parsed.rejected,
      duplicates: parsed.duplicates,
      unknown,
      errors: parsed.errors.slice(0, 12),
      message: `${parts.join(', ')}. Черновите и публикуваните секции не са пипани.`,
    }
  })

/** Every priority section with how it is covered now, open ones first by R desc. */
export const adminPrioritySections = createServerFn({ method: 'POST' })
  .handler(async () => {
    const access = await gate('view')
    if (!access.ok) return access
    const loaded = await loadPriority(access.db)
    return { ok: true as const, ...loaded }
  })

/** Counts only, for the dashboard. */
export const adminPriorityCoverage = createServerFn({ method: 'POST' })
  .handler(async () => {
    const access = await gate('view')
    if (!access.ok) return access
    const loaded = await loadPriority(access.db)
    return { ok: true as const, summary: loaded.summary, updatedAt: loaded.updatedAt }
  })

export async function loadPriorityRows(db: Database) {
  const result = await db
    .prepare('SELECT section_code, town, municipality, oblast, r, level, updated_at FROM priority_sections')
    .all<{ section_code: string; town: string; municipality: string; oblast: string; r: number | null; level: string; updated_at: string }>()
  return (result.results ?? []).map((row) => ({
    sectionCode: row.section_code,
    town: row.town,
    municipality: row.municipality,
    oblast: row.oblast,
    r: row.r === null || row.r === undefined ? null : Number(row.r),
    level: row.level,
    updatedAt: row.updated_at,
  }))
}

async function loadPriority(db: Database) {
  const rows = await loadPriorityRows(db)
  const assigned = await db
    .prepare(
      `SELECT COALESCE(draft_section, '') AS draft_section, COALESCE(published_section, '') AS published_section
       FROM signups WHERE COALESCE(withdrawn, 0) = 0 AND (COALESCE(draft_section, '') != '' OR COALESCE(published_section, '') != '')`,
    )
    .all<{ draft_section: string; published_section: string }>()
  const taken = await db.prepare('SELECT section_code FROM taken_sections').all<{ section_code: string }>()
  const published = new Set<string>()
  const drafts = new Set<string>()
  for (const row of assigned.results ?? []) {
    if (row.published_section) published.add(priorityCode(row.published_section))
    if (row.draft_section) drafts.add(priorityCode(row.draft_section))
  }
  const takenCodes = new Set((taken.results ?? []).map((row) => priorityCode(row.section_code)))
  const sections: PrioritySectionView[] = sortForAssignment(
    rows.map((row) => ({
      sectionCode: row.sectionCode,
      town: row.town,
      municipality: row.municipality,
      oblast: row.oblast,
      r: row.r,
      level: row.level,
      state: coverageState(row.sectionCode, published, drafts, takenCodes),
    })),
  )
  return {
    sections,
    summary: summarizePriorityCoverage(rows, published, drafts, takenCodes),
    updatedAt: rows.reduce((latest, row) => (row.updatedAt > latest ? row.updatedAt : latest), ''),
  }
}

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

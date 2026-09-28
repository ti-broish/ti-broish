import { createServerFn } from '@tanstack/react-start'
import { getCookie, getRequestUrl } from '@tanstack/react-start/server'
import { publishBlocked, validateAssignment, warningSummary } from './admin-assign'
import { normalizeSection } from './admin-csv'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { assignmentMail, deliverMail } from './mail'
import { parseStaffRole, roleAllows } from './staff'

async function publishAccess() {
  const db = await signupDatabase()
  if (!db) return { ok: false as const, message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false as const, message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{ email: string; email_confirmed: number }>()
  if (!session) return { ok: false as const, message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  if (!session.email_confirmed) return { ok: false as const, message: 'Потвърди имейла, за да влезеш в екипа.' }
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role || !roleAllows(role, 'publish')) return { ok: false as const, message: 'Тази роля няма това право.' }
  return { ok: true as const, db }
}

function origin() {
  const url = getRequestUrl()
  return `${url.protocol}//${url.host}`
}

async function blockReason(db: SignupD1, section: string, personId: string, personMir: string) {
  const code = normalizeSection(section)
  const taken = await db.prepare('SELECT organisation FROM taken_sections WHERE section_code = ?').bind(code).first<{ organisation: string }>()
  const published = await db
    .prepare(`SELECT id, email FROM signups WHERE id != ? AND COALESCE(withdrawn, 0) = 0 AND COALESCE(published_section, '') = ? LIMIT 1`)
    .bind(personId, code)
    .first<{ id: string; email: string }>()
  const draft = published
    ? null
    : await db
        .prepare(`SELECT id, email FROM signups WHERE id != ? AND COALESCE(withdrawn, 0) = 0 AND COALESCE(draft_section, '') = ? LIMIT 1`)
        .bind(personId, code)
        .first<{ id: string; email: string }>()
  const duplicate = published
    ? { id: published.id, email: published.email, kind: 'published' as const }
    : draft
      ? { id: draft.id, email: draft.email, kind: 'draft' as const }
      : null
  const warnings = validateAssignment({
    section: code,
    personId,
    personMir,
    takenOrg: taken?.organisation ?? null,
    duplicate,
  })
  return publishBlocked(warnings) ? warningSummary(warnings) : ''
}

export const adminPublishOne = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const access = await publishAccess()
    if (!access.ok) return access
    const db = access.db
    const row = await db
      .prepare(
        `SELECT email,
                COALESCE(mir_code, '') AS mir,
                COALESCE(draft_section, '') AS draft_section,
                COALESCE(published_section, '') AS published_section,
                COALESCE(section_place, '') AS section_place,
                COALESCE(json_extract(payload, '$.place.sectionPlace'), '') AS payload_place
         FROM signups WHERE id = ?`,
      )
      .bind(data.id)
      .first<{ email: string; mir: string; draft_section: string; published_section: string; section_place: string; payload_place: string }>()
    if (!row) return { ok: false as const, message: 'Няма такова записване.' }
    const section = row.draft_section || row.published_section
    if (!section) return { ok: false as const, message: 'Няма чернова или публикувана секция за този човек.' }
    const blocked = await blockReason(db, section, data.id, row.mir)
    if (blocked) return { ok: false as const, message: `Не публикувам: ${blocked}` }
    const now = new Date().toISOString()
    if (row.draft_section && row.draft_section !== row.published_section) {
      await db
        .prepare(`UPDATE signups SET published_section = draft_section, published_at = ?, updated_at = ? WHERE id = ?`)
        .bind(now, now, data.id)
        .run()
    }
    const address = row.section_place || row.payload_place || ''
    const sent = await deliverMail(assignmentMail(row.email, section, address, `${origin()}/profil`))
    return {
      ok: true as const,
      sent,
      section,
      message: sent
        ? `Секция ${section} е публикувана и ${row.email} е известен.`
        : `Секция ${section} е публикувана. Писмото не тръгна — пробвай пак или кажи на човека да отвори профила.`,
    }
  })

export const adminNotifyAssignment = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const access = await publishAccess()
    if (!access.ok) return access
    const db = access.db
    const row = await db
      .prepare(
        `SELECT email,
                COALESCE(published_section, '') AS published_section,
                COALESCE(section_place, '') AS section_place,
                COALESCE(json_extract(payload, '$.place.sectionPlace'), '') AS payload_place
         FROM signups WHERE id = ?`,
      )
      .bind(data.id)
      .first<{ email: string; published_section: string; section_place: string; payload_place: string }>()
    if (!row) return { ok: false as const, message: 'Няма такова записване.' }
    if (!row.published_section) return { ok: false as const, message: 'Първо публикувай секцията за този човек, после извести.' }
    const address = row.section_place || row.payload_place || ''
    const sent = await deliverMail(assignmentMail(row.email, row.published_section, address, `${origin()}/profil`))
    return {
      ok: true as const,
      sent,
      message: sent ? `Изпратено до ${row.email}.` : 'Писмото не тръгна. Пробвай пак по-късно.',
    }
  })

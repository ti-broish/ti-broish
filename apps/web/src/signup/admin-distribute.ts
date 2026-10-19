import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { describeClearedDrafts, describeDistribution } from './distribute'
import { planCountryDistribution } from './distribute-plan'
import { reservedMap } from './reserved-sections-db'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

/**
 * „Направи чернови за страната“. Drafts only: never published_section, never mail or Brevo.
 * With onlyEmpty, every existing draft stays and only people with no section get one.
 */
export const adminDistribute = createServerFn({ method: 'POST' })
  .inputValidator((input: { onlyEmpty?: boolean } | undefined) => ({ onlyEmpty: input?.onlyEmpty === true }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const planned = await planCountryDistribution(db, { keepDrafts: data.onlyEmpty })
    if (!planned.ok) return planned
    const { plan, loaded } = planned

    const now = new Date().toISOString()
    if (!data.onlyEmpty) {
      await db
        .prepare(
          `UPDATE signups
           SET draft_section = NULL, updated_at = ?
           WHERE COALESCE(published_section, '') = ''
             AND COALESCE(draft_locked, 0) = 0
             AND COALESCE(draft_section, '') != ''
             AND COALESCE(submitted, 0) = 1
             AND COALESCE(withdrawn, 0) = 0`,
        )
        .bind(now)
        .run()
    }
    let drafted = 0
    let paper = 0
    // Reserved by another org (taken_sections): the plan already skips them; the triggers are the last word.
    const reserved = await reservedMap(db)
    for (const row of plan.assignments) {
      if (reserved.has(row.sectionId)) continue
      const result = await db
        .prepare(
          `UPDATE signups
           SET draft_section = ?, draft_locked = 0, updated_at = ?
           WHERE id = ?
             AND COALESCE(published_section, '') = ''
             AND COALESCE(draft_locked, 0) = 0
             AND COALESCE(submitted, 0) = 1
             AND COALESCE(withdrawn, 0) = 0
             AND COALESCE(role, '') = 'section'
             AND (? = 0 OR COALESCE(draft_section, '') = '')`,
        )
        .bind(row.sectionId, now, row.personId, data.onlyEmpty ? 1 : 0)
        .run()
        .catch(() => null)
      if (!result || !changed(result)) continue
      drafted += 1
      if (row.desk === 'paper') paper += 1
    }
    const skipped = (reason: string) => plan.skipped.filter((row) => row.reason === reason).length
    return {
      ok: true as const,
      message: describeDistribution({
        drafted,
        paper,
        kept: loaded.kept,
        mobile: skipped('mobile'),
        video: skipped('video'),
        abroad: skipped('abroad'),
        noPlace: skipped('no-place'),
        noSection: skipped('no-section'),
        keptAtAddress: plan.keptAtAddress,
      }),
    }
  })

const pendingDraft = `COALESCE(draft_section, '') != '' AND COALESCE(draft_section, '') != COALESCE(published_section, '')`

export const adminClearDrafts = createServerFn({ method: 'POST' })
  .handler(async () => {
    const access = await gate('edit')
    if (!access.ok) return access
    const countRow = await access.db.prepare(`SELECT COUNT(*) AS n FROM signups WHERE ${pendingDraft}`).first<{ n: number }>()
    const cleared = Number(countRow?.n ?? 0)
    if (cleared > 0) {
      await access.db
        .prepare(
          `UPDATE signups
           SET draft_section = NULLIF(COALESCE(published_section, ''), ''),
               draft_locked = 0,
               updated_at = ?
           WHERE ${pendingDraft}`,
        )
        .bind(new Date().toISOString())
        .run()
    }
    return { ok: true as const, cleared, message: describeClearedDrafts(cleared) }
  })

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

function changed(result: unknown) {
  if (!result || typeof result !== 'object') return true
  const changes = (result as { meta?: { changes?: unknown } }).meta?.changes
  return typeof changes === 'number' ? changes > 0 : true
}

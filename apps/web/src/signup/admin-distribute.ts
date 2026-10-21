import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { describeClearedDrafts, describeDistribution } from './distribute'
import { planCountryDistribution } from './distribute-plan'
import { reservedMap } from './reserved-sections-db'
import { describeMobileRun, planMobileAreasForRun, writeMobileAreas } from './mobile-auto'
import { AUTO_DRAFT_WHERE, CLEAR_AUTO_DRAFTS_SQL, RERUN_CLEAR_AUTO_DRAFTS_SQL, RERUN_WRITE_DRAFT_SQL } from './distribute-rerun-sql'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

/**
 * „Направи чернови за страната“. Drafts only: never published_section, never mail or Brevo.
 * With onlyEmpty, every existing draft stays and only people with no section get one.
 * Mobile-team volunteers: a section draft after every section volunteer (same order, from what is
 * left), then an area with target priority sections (mobile_drafts, mobile-auto.ts).
 */
export const adminDistribute = createServerFn({ method: 'POST' })
  .inputValidator((input: { onlyEmpty?: boolean } | undefined) => ({ onlyEmpty: input?.onlyEmpty === true }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const planned = await planCountryDistribution(db, { keepDrafts: data.onlyEmpty })
    if (!planned.ok) return planned
    const { plan, mobilePlan, loaded } = planned

    const now = new Date().toISOString()
    if (!data.onlyEmpty) {
      await db
        .prepare(RERUN_CLEAR_AUTO_DRAFTS_SQL)
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
        .prepare(RERUN_WRITE_DRAFT_SQL)
        .bind(row.sectionId, now, row.personId, data.onlyEmpty ? 1 : 0)
        .run()
        .catch(() => null)
      if (!result || !changed(result)) continue
      drafted += 1
      if (row.desk === 'paper') paper += 1
    }
    let mobileDrafted = 0
    for (const row of mobilePlan.assignments) {
      if (reserved.has(row.sectionId)) continue
      const result = await db
        .prepare(RERUN_WRITE_DRAFT_SQL)
        .bind(row.sectionId, now, row.personId, data.onlyEmpty ? 1 : 0)
        .run()
        .catch(() => null)
      if (result && changed(result)) mobileDrafted += 1
    }
    // Areas after the section drafts are written, so a target never has a section person.
    const mobileAreas = await planMobileAreasForRun(db, { keepAll: data.onlyEmpty })
    const written = await writeMobileAreas(db, mobileAreas, access.email, now)
    const skipped = (reason: string) => plan.skipped.filter((row) => row.reason === reason).length
    const mobileText = describeMobileRun({
      sectionDrafts: mobileDrafted,
      noSection: mobilePlan.skipped.filter((row) => row.reason === 'no-section' || row.reason === 'no-place').length,
      planned: mobileAreas,
      written,
    })
    return {
      ok: true as const,
      mobile: { sectionDrafts: mobileDrafted, areas: written.drafted, kept: mobileAreas.kept.length, removed: written.removed, noArea: mobileAreas.plan.skipped.length },
      message: `${describeDistribution({
        drafted,
        paper,
        kept: loaded.kept,
        mobile: 0,
        video: skipped('video'),
        abroad: skipped('abroad'),
        noPlace: skipped('no-place'),
        noSection: skipped('no-section'),
        outsideMir: skipped('outside-mir'),
        keptAtAddress: plan.keptAtAddress,
      })} ${mobileText}`,
    }
  })

/** „Изчисти черновите“: only automatic drafts. Manual drafts and published sections stay. */
export const adminClearDrafts = createServerFn({ method: 'POST' })
  .handler(async () => {
    const access = await gate('edit')
    if (!access.ok) return access
    const countRow = await access.db.prepare(`SELECT COUNT(*) AS n FROM signups WHERE ${AUTO_DRAFT_WHERE}`).first<{ n: number }>()
    const cleared = Number(countRow?.n ?? 0)
    if (cleared > 0) await access.db.prepare(CLEAR_AUTO_DRAFTS_SQL).bind(new Date().toISOString()).run()
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

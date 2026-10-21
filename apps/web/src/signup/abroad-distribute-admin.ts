import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { normalizeSection } from './admin-csv'
import {
  distributeAbroad,
  type AbroadDistributePerson,
  type AbroadDistributePlan,
  type AbroadDistributeSection,
} from './abroad-distribute'
import type { AbroadTierLetter } from './abroad-coverage'
import { distributionHold, heldSectionCodes } from './distribute'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1

/**
 * Who the abroad allocator drafts: living abroad, or numbered for МИР 32. A numbered пълномощно is valid
 * only in its МИР, so someone numbered for a МИР in Bulgaria is never drafted abroad.
 */
export const ABROAD_PERSON_WHERE = `(designation_number IS NULL OR COALESCE(designation_mir, '') = '32')
  AND (COALESCE(region_code, '') = '32' OR COALESCE(mir_code, '') = '32' OR (designation_number IS NOT NULL AND designation_mir = '32'))`
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

/**
 * Dry-run abroad distribution. Does not write drafts and does not send mail/Brevo.
 * Persist only via adminSaveAbroadDrafts.
 */
export const adminAbroadDistributePreview = createServerFn({ method: 'POST' }).handler(async () => {
  const access = await gate('edit')
  if (!access.ok) return access
  const plan = await buildPlan(access.db)
  return {
    ok: true as const,
    plan,
    message: describeAbroadPlan(plan),
  }
})

/**
 * Saves abroad assignments as DRAFT only (draft_section, draft_locked=0).
 * Same persistence shape as domestic adminDistribute — never published_section, never mail/Brevo.
 */
export const adminSaveAbroadDrafts = createServerFn({ method: 'POST' }).handler(async () => {
  const access = await gate('edit')
  if (!access.ok) return access
  const db = access.db
  const plan = await buildPlan(db)
  const now = new Date().toISOString()
  let drafted = 0
  for (const row of plan.assignments) {
    const result = await db
      .prepare(
        `UPDATE signups
         SET draft_section = ?, draft_locked = 0, updated_at = ?
         WHERE id = ?
           AND COALESCE(published_section, '') = ''
           AND COALESCE(draft_locked, 0) = 0
           AND COALESCE(submitted, 0) = 1
           AND COALESCE(withdrawn, 0) = 0
           AND ${ABROAD_PERSON_WHERE}`,
      )
      .bind(row.sectionId, now, row.personId)
      .run()
    if (changed(result)) drafted += 1
  }
  return {
    ok: true as const,
    drafted,
    plan,
    message: `Записахме ${drafted} чернови в чужбина (без публикуване и без писмо). ${describeAbroadPlan(plan)}`,
  }
})

async function buildPlan(db: Database): Promise<AbroadDistributePlan> {
  const people = await loadAbroadPeople(db)
  const sections = await loadPrioritySections(db)
  const blocked = await blockedSections(db)
  return distributeAbroad({ people: people.candidates, sections, blocked })
}

async function loadAbroadPeople(db: Database) {
  const signups = await db
    .prepare(
      `SELECT id, email,
        COALESCE(role, '') AS role,
        COALESCE(mir_code, '') AS mir,
        COALESCE(region_code, '') AS region_code,
        COALESCE(town_name, '') AS town_name,
        COALESCE(draft_section, '') AS draft_section,
        COALESCE(draft_locked, 0) AS draft_locked,
        COALESCE(published_section, '') AS published_section,
        payload
      FROM signups
      WHERE COALESCE(submitted, 0) = 1
        AND COALESCE(withdrawn, 0) = 0
        AND ${ABROAD_PERSON_WHERE}`,
    )
    .all<{
      id: string
      email: string
      role: string
      mir: string
      region_code: string
      town_name: string
      draft_section: string
      draft_locked: number
      published_section: string
      payload: string
    }>()

  const candidates: AbroadDistributePerson[] = []
  for (const row of signups.results ?? []) {
    const hold = distributionHold({
      draftSection: row.draft_section,
      publishedSection: row.published_section,
      locked: row.draft_locked === 1,
    })
    if (hold !== 'rewrite') continue
    const place = readPlace(row.payload)
    candidates.push({
      id: row.id,
      email: row.email.trim().toLowerCase(),
      role: row.role,
      mobileTeam: place.mobileTeam,
      // Numbered for МИР 32 while living in Bulgaria: abroad is their only reach.
      regionCode: row.region_code === '32' || row.mir === '32' ? row.region_code || '32' : '32',
      mir: row.region_code === '32' || row.mir === '32' ? row.mir || '32' : '32',
      countryName: place.countryName,
      cityName: row.town_name || place.townName,
    })
  }
  return { candidates }
}

async function loadPrioritySections(db: Database): Promise<AbroadDistributeSection[]> {
  const result = await db
    .prepare(
      `SELECT section_code, country, city, place_label, tier_letter,
              ppdb_seats_without_nominee, members
       FROM abroad_priority_sections`,
    )
    .all<{
      section_code: string
      country: string
      city: string
      place_label: string
      tier_letter: string
      ppdb_seats_without_nominee: number
      members: number
    }>()
  return (result.results ?? []).map((row) => {
    return {
      id: normalizeSection(row.section_code),
      country: row.country,
      city: row.city,
      placeLabel: row.place_label,
      tierLetter: row.tier_letter as AbroadTierLetter,
      // One volunteer per section — a second draft would be a duplicate that blocks publish.
      capacity: 1,
      emptyPpdbSeats: Number(row.ppdb_seats_without_nominee) || 0,
    }
  })
}

async function blockedSections(db: Database) {
  const blocked = new Set<string>()
  const taken = await db.prepare('SELECT section_code FROM taken_sections').all<{ section_code: string }>()
  for (const row of taken.results ?? []) blocked.add(normalizeSection(row.section_code))
  const used = await db
    .prepare(
      `SELECT COALESCE(draft_section, '') AS draft_section,
              COALESCE(published_section, '') AS published_section,
              COALESCE(draft_locked, 0) AS draft_locked
       FROM signups
       WHERE COALESCE(withdrawn, 0) = 0
         AND (COALESCE(draft_section, '') != '' OR COALESCE(published_section, '') != '')`,
    )
    .all<{ draft_section: string; published_section: string; draft_locked: number }>()
  for (const code of heldSectionCodes(
    (used.results ?? []).map((row) => ({
      draftSection: row.draft_section,
      publishedSection: row.published_section,
      locked: row.draft_locked === 1,
    })),
  )) {
    blocked.add(code)
  }
  return [...blocked]
}

function readPlace(payload: string) {
  try {
    const parsed = JSON.parse(payload) as {
      mobileTeam?: boolean
      place?: { countryName?: string; townName?: string }
    }
    return {
      mobileTeam: parsed.mobileTeam === true,
      countryName: parsed.place?.countryName?.trim() ?? '',
      townName: parsed.place?.townName?.trim() ?? '',
    }
  } catch {
    return { mobileTeam: false, countryName: '', townName: '' }
  }
}

function describeAbroadPlan(plan: AbroadDistributePlan) {
  const parts = [`Предложение: ${plan.counts.assigned} чернови`]
  const tiers = (['C', 'D', 'B', 'A'] as const)
    .map((letter) => {
      const n = plan.counts.byTier[letter] ?? 0
      return n ? `${letter}:${n}` : ''
    })
    .filter(Boolean)
  if (tiers.length) parts.push(`по tier ${tiers.join(' ')}`)
  const unmatched = Object.entries(plan.counts.unmatchedByReason)
    .filter(([, n]) => n)
    .map(([reason, n]) => `${reason}:${n}`)
  if (unmatched.length) parts.push(`без място ${unmatched.join(' ')}`)
  return parts.join(' · ')
}

function changed(result: unknown) {
  const meta = result as { meta?: { changes?: number } } | null
  return (meta?.meta?.changes ?? 0) > 0
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

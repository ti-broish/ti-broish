import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { mobileRoundsLabel, type MobileArea } from './mobile-teams'
import { loadMobileDrafts, loadMobilePeople, suggestMobileAreas } from './mobile-teams-db'
import { describeMobileRun, planMobileAreasForRun, writeMobileAreas } from './mobile-auto'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

/**
 * Mobile-team drafts. Drafts only: never published_section, never numbering, mail or Brevo.
 * A mobile draft is an area plus target priority sections; it never touches draft_section.
 */
type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

/** Every mobile draft, with names, for Секции, Записани and the person page. */
export const adminMobileDrafts = createServerFn({ method: 'POST' }).handler(async () => {
  const access = await gate('view')
  if (!access.ok) return access
  const db = access.db
  const drafts = await loadMobileDrafts(db)
  const people = await db
    .prepare(
      `SELECT id, TRIM(COALESCE(json_extract(payload, '$.firstName'), '') || ' ' || COALESCE(json_extract(payload, '$.lastName'), '')) AS name,
              rounds_first, rounds_runoff, has_car, has_drone
       FROM signups WHERE id IN (SELECT signup_id FROM mobile_drafts)`,
    )
    .all<{ id: string; name: string; rounds_first: number | null; rounds_runoff: number | null; has_car: number | null; has_drone: number | null }>()
  const byId = new Map((people.results ?? []).map((row) => [row.id, row]))
  // Active mobile people with no area yet (with or without a section).
  const withArea = new Set(drafts.map((draft) => draft.signupId))
  const waiting = (await loadMobilePeople(db)).filter((person) => !withArea.has(person.id)).length
  return {
    ok: true as const,
    waiting,
    drafts: drafts
      .map((draft) => {
        const person = byId.get(draft.signupId)
        return {
          ...draft,
          name: person?.name ?? '',
          rounds: mobileRoundsLabel({ roundsFirst: person?.rounds_first !== 0, roundsRunoff: person?.rounds_runoff !== 0 }),
          car: person?.has_car === 1,
          drone: person?.has_drone === 1,
        }
      })
      .sort((a, b) => a.mir.localeCompare(b.mir) || a.areaLabel.localeCompare(b.areaLabel, 'bg') || a.name.localeCompare(b.name, 'bg')),
  }
})

/**
 * „Чернови за мобилни екипи“: an area for every mobile person who has none yet (every existing
 * mobile draft stays); dryRun only reports. „Направи чернови за страната“ does this too, after sections.
 */
export const adminMobileDistribute = createServerFn({ method: 'POST' })
  .inputValidator((input: { dryRun?: boolean } | undefined) => ({ dryRun: input?.dryRun === true }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const planned = await planMobileAreasForRun(db, { keepAll: true })
    const plan = planned.plan
    if (data.dryRun) {
      const text = describeMobileRun({ planned, written: { drafted: 0, removed: 0 }, dryRun: true })
      return { ok: true as const, drafted: 0, plan, message: `Преглед (нищо не е записано): ${text}` }
    }
    const written = await writeMobileAreas(db, planned, access.email, new Date().toISOString())
    const text = describeMobileRun({ planned, written })
    return { ok: true as const, drafted: written.drafted, plan, message: `${text} Нищо не е публикувано.` }
  })

/** The open areas within one mobile person's reach, for the person page's area picker. */
export const adminMobileAreas = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => ({ id: String(input?.id ?? '') }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const { person, areas } = await suggestMobileAreas(access.db, data.id)
    if (!person) return { ok: false as const, message: 'Това не е мобилен екип.' }
    return { ok: true as const, areas, message: areas.length ? '' : 'Няма непокрита приоритетна секция в обхвата на човека.' }
  })

/** „Запази“: save one area as this person's manual mobile draft (replaces their previous one). Never publishes. */
export const adminMobileSave = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; areaKey: string }) => ({ id: String(input?.id ?? ''), areaKey: String(input?.areaKey ?? '') }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const { person, areas } = await suggestMobileAreas(access.db, data.id, 50)
    const area = areas.find((item) => item.key === data.areaKey)
    if (!person || !area) return { ok: false as const, message: 'Този район вече не е свободен. Избери друг.' }
    const ok = await saveDraft(access.db, person.id, person.id, area, 'manual', access.email, new Date().toISOString(), false)
    return ok
      ? { ok: true as const, message: `Чернова за мобилен екип: ${area.label}, ${area.targets.length} секции. Не е публикувана.` }
      : { ok: false as const, message: 'Черновата не се записа. Някоя от секциите е резервирана от друга организация.' }
  })

export const adminMobileRemove = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => ({ id: String(input?.id ?? '') }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    await access.db.prepare('DELETE FROM mobile_drafts WHERE signup_id = ?').bind(data.id).run()
    return { ok: true as const, message: 'Махнахме черновата за мобилен екип.' }
  })

async function saveDraft(db: Database, signupId: string, teamKey: string, area: MobileArea, source: 'auto' | 'manual', by: string, now: string, onlyMissing: boolean) {
  const targets = JSON.stringify(area.targets)
  const guard = onlyMissing
    ? `AND COALESCE(s.draft_section, '') = '' AND COALESCE(s.published_section, '') = '' AND NOT EXISTS (SELECT 1 FROM mobile_drafts m WHERE m.signup_id = s.id)`
    : ''
  try {
    const result = await db
      .prepare(
        `INSERT INTO mobile_drafts (signup_id, team_key, mir_code, municipality_code, area_key, area_label, targets, source, created_by, created_at, updated_at)
         SELECT s.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM signups s
         WHERE s.id = ?
           AND COALESCE(s.submitted, 0) = 1
           AND COALESCE(s.withdrawn, 0) = 0
           AND (COALESCE(s.role, '') = 'mobile' OR json_extract(s.payload, '$.mobileTeam') = 1)
           AND COALESCE(s.region_code, '') != '32' AND COALESCE(s.mir_code, '') != '32'
           ${guard}
         ON CONFLICT(signup_id) DO UPDATE SET team_key = excluded.team_key, mir_code = excluded.mir_code,
           municipality_code = excluded.municipality_code, area_key = excluded.area_key, area_label = excluded.area_label,
           targets = excluded.targets, source = excluded.source, created_by = excluded.created_by, updated_at = excluded.updated_at`,
      )
      .bind(teamKey, area.mir, area.municipality, area.key, area.label, targets, source, by, now, now, signupId)
      .run()
    const changes = (result as { meta?: { changes?: number } }).meta?.changes
    return typeof changes === 'number' ? changes > 0 : true
  } catch {
    return false
  }
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

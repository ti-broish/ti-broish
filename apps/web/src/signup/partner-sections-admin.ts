import { createServerFn } from '@tanstack/react-start'
import { egnDigits } from './egn-reveal'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { fetchApiJson } from './distribute-plan'
import { PARTNER_RESERVATION_ORG, isSectionHeldAbort } from './partner-people-sql'
import {
  PARTNER_ALSO_VOLUNTEER_SQL,
  PARTNER_BLOCKED_SQL,
  PARTNER_DRAFT_WRITE_SQL,
  PARTNER_PRIORITY_SQL,
  PARTNER_SECTION_PEOPLE_SQL,
  blockedCodes,
  code9,
  describePartnerPlan,
  partnerPersonFrom,
  planPartnerDistribution,
  publishStatements,
  unpublishStatements,
  type PriorityRow,
} from './partner-sections'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

/**
 * „И аз“ — секции. Drafts and publishing for partner people. Publishing only sets
 * section_published and the „И аз“ reservation: no email, no Brevo, no profile, no login.
 */
type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

type PeopleRow = Parameters<typeof partnerPersonFrom>[0]

async function loadContext(db: Database) {
  const people = ((await db.prepare(PARTNER_SECTION_PEOPLE_SQL).all<PeopleRow>()).results ?? []).map(partnerPersonFrom)
  const held = (await db.prepare(PARTNER_BLOCKED_SQL).all<{ code: string; src: string }>()).results ?? []
  let priorityRows: PriorityRow[] = []
  try {
    priorityRows = (await db.prepare(PARTNER_PRIORITY_SQL).all<PriorityRow>()).results ?? []
  } catch {
    priorityRows = []
  }
  let alsoVolunteer = new Set<string>()
  try {
    alsoVolunteer = new Set(((await db.prepare(PARTNER_ALSO_VOLUNTEER_SQL).all<{ id: string }>()).results ?? []).map((row) => row.id))
  } catch {
    alsoVolunteer = new Set()
  }
  const priority = new Map<string, { r: number | null; level: string }>()
  for (const row of priorityRows) {
    const code = code9(row.section_code)
    if (code) priority.set(code, { r: row.r === null || row.r === undefined ? null : Number(row.r), level: row.level ?? '' })
  }
  return { people, held, priority, alsoVolunteer }
}

/** The tab: every partner person with their draft and published section. */
export const adminPartnerSections = createServerFn({ method: 'POST' }).handler(async () => {
  const access = await gate('view')
  if (!access.ok) return access
  const db = access.db
  const rows =
    (
      await db
        .prepare(
          `SELECT p.id, TRIM(p.first_name || ' ' || p.last_name) AS name, COALESCE(p.designation_mir, '') AS mir, p.designation_number AS number,
                  p.municipality_name AS municipality, COALESCE(p.section_draft, '') AS draft, COALESCE(p.section_published, '') AS published,
                  COALESCE(p.section_draft_locked, 0) AS locked, COALESCE(p.section_draft_source, '') AS source,
                  p.egn AS egn,
                  d.r AS draft_r, d.level AS draft_level, q.r AS published_r, q.level AS published_level
           FROM partner_people p
           LEFT JOIN priority_sections d ON d.section_code = p.section_draft
           LEFT JOIN priority_sections q ON q.section_code = p.section_published
           ORDER BY p.designation_mir, p.designation_number, p.id`,
        )
        .all<{
          id: string
          name: string
          mir: string
          number: number | null
          municipality: string
          draft: string
          published: string
          locked: number
          source: string
          egn: string | null
          draft_r: number | null
          draft_level: string | null
          published_r: number | null
          published_level: string | null
        }>()
    ).results ?? []
  const info = (r: number | null, level: string | null) => (level === null || level === undefined ? null : { r: r === null ? null : Number(r), level })
  const people = rows.map((row) => ({
    id: row.id,
    name: row.name,
    mir: row.mir,
    number: row.number,
    municipality: row.municipality,
    draft: row.draft,
    published: row.published,
    locked: row.locked === 1,
    source: row.source,
    draftPriority: info(row.draft_r, row.draft_level),
    publishedPriority: info(row.published_r, row.published_level),
    // Only whether there is one; „Покажи ЕГН“ asks for the number (admins, audited).
    hasEgn: Boolean(egnDigits(row.egn)),
  }))
  return {
    ok: true as const,
    people,
    counts: {
      total: people.length,
      drafted: people.filter((row) => row.draft && row.draft !== row.published).length,
      published: people.filter((row) => row.published).length,
      waiting: people.filter((row) => !row.draft && !row.published).length,
    },
  }
})

/** „Чернови за „И аз““: drafts only for people with no section yet. dryRun writes nothing. */
export const adminPartnerDistribute = createServerFn({ method: 'POST' })
  .inputValidator((input: { dryRun?: boolean } | undefined) => ({ dryRun: input?.dryRun === true }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const context = await loadContext(db)
    const blocked = blockedCodes(context.held)
    const planned = await planPartnerDistribution({
      people: context.people,
      blocked,
      priority: context.priority,
      alsoVolunteer: context.alsoVolunteer,
      getJson: fetchApiJson,
    })
    if (!planned.ok) return { ok: false as const, state: 'nodb' as const, email: '', message: planned.message }
    const plan = planned.plan
    if (data.dryRun) return { ok: true as const, drafted: 0, plan, message: `Преглед (нищо не е записано): ${describePartnerPlan(plan)}` }
    const now = new Date().toISOString()
    let drafted = 0
    let refused = 0
    for (const row of plan.drafts) {
      try {
        const result = await db.prepare(PARTNER_DRAFT_WRITE_SQL).bind(row.code, now, now, row.personId).run()
        if (changed(result)) drafted += 1
      } catch (error) {
        if (!isSectionHeldAbort(error)) throw error
        refused += 1
      }
    }
    return {
      ok: true as const,
      drafted,
      plan,
      message: `Записани чернови ${drafted}${refused ? ` (${refused} секции вече бяха заети)` : ''}. ${describePartnerPlan(plan)}`,
    }
  })

/** „Запази“ a draft (or clear it with an empty section). Locked: „Чернови“ will not change it. */
export const adminPartnerSave = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; section: string }) => ({ id: String(input?.id ?? ''), section: String(input?.section ?? '') }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const person = await db
      .prepare(`SELECT id, COALESCE(designation_mir, '') AS mir, COALESCE(section_published, '') AS published FROM partner_people WHERE id = ?`)
      .bind(data.id)
      .first<{ id: string; mir: string; published: string }>()
    if (!person) return { ok: false as const, message: 'Няма такъв човек от „И аз“.' }
    const now = new Date().toISOString()
    if (!data.section.trim()) {
      await db
        .prepare(`UPDATE partner_people SET section_draft = NULLIF(?, ''), section_draft_locked = 0, section_draft_source = NULL, updated_at = ? WHERE id = ?`)
        .bind(person.published, now, person.id)
        .run()
      return { ok: true as const, message: person.published ? 'Черновата е върната към публикуваната секция.' : 'Черновата е махната.' }
    }
    const code = code9(data.section)
    if (!code) return { ok: false as const, message: 'Секцията е 9 цифри.' }
    if (!person.mir || !code.startsWith(person.mir)) {
      return { ok: false as const, message: `Секция ${code} не е в МИР ${person.mir || '—'}. Пълномощното е за този МИР.` }
    }
    const holder = await holderOf(db, code, person.id)
    if (holder) return { ok: false as const, message: `Секция ${code} е заета: ${holder}.` }
    try {
      await db
        .prepare(`UPDATE partner_people SET section_draft = ?, section_draft_locked = 1, section_draft_source = 'manual', section_drafted_at = ?, updated_at = ? WHERE id = ?`)
        .bind(code, now, now, person.id)
        .run()
    } catch (error) {
      if (isSectionHeldAbort(error)) return { ok: false as const, message: `Секция ${code} вече е заета.` }
      throw error
    }
    return { ok: true as const, message: `Чернова ${code} е запазена (не е публикувана).` }
  })

/**
 * Publish drafts: section_published = section_draft and the „И аз“ reservation, in one
 * transaction per person. No email, no Brevo, no profile, no login. ids empty = every pending draft.
 */
export const adminPartnerPublish = createServerFn({ method: 'POST' })
  .inputValidator((input: { ids?: string[] } | undefined) => ({ ids: Array.isArray(input?.ids) ? input!.ids.map(String).slice(0, 5000) : [] }))
  .handler(async ({ data }) => {
    const access = await gate('publish')
    if (!access.ok) return access
    const db = access.db
    const pending =
      (
        await db
          .prepare(
            `SELECT id, COALESCE(designation_mir, '') AS mir, section_draft AS draft, COALESCE(section_published, '') AS published FROM partner_people
             WHERE COALESCE(section_draft, '') != '' AND section_draft IS NOT section_published`,
          )
          .all<{ id: string; mir: string; draft: string; published: string }>()
      ).results ?? []
    const wanted = data.ids.length ? new Set(data.ids) : null
    const now = new Date().toISOString()
    let published = 0
    const blocked: Array<{ id: string; section: string; reason: string }> = []
    for (const row of pending) {
      if (wanted && !wanted.has(row.id)) continue
      const holder = await holderOf(db, row.draft, row.id)
      if (holder) {
        blocked.push({ id: row.id, section: row.draft, reason: holder })
        continue
      }
      try {
        await db.batch(publishStatements(db, row, now))
        published += 1
      } catch (error) {
        if (!isSectionHeldAbort(error)) throw error
        blocked.push({ id: row.id, section: row.draft, reason: 'заета' })
      }
    }
    return {
      ok: true as const,
      published,
      blocked,
      message: `Публикувани ${published}${blocked.length ? `, спрени ${blocked.length} (заета секция)` : ''}. Секциите са резервирани като „${PARTNER_RESERVATION_ORG}“. Без писма и без Brevo.`,
    }
  })

/** Undo publishing: the „И аз“ reservation goes, the draft stays. */
export const adminPartnerUnpublish = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => ({ id: String(input?.id ?? '') }))
  .handler(async ({ data }) => {
    const access = await gate('publish')
    if (!access.ok) return access
    const db = access.db
    const row = await db
      .prepare(`SELECT id, COALESCE(section_published, '') AS published FROM partner_people WHERE id = ?`)
      .bind(data.id)
      .first<{ id: string; published: string }>()
    if (!row || !row.published) return { ok: false as const, message: 'Няма публикувана секция.' }
    await db.batch(unpublishStatements(db, row, new Date().toISOString()))
    return { ok: true as const, message: `Секция ${row.published} вече не е публикувана и не е резервирана. Черновата остава.` }
  })

/** Who else holds this code, in words, or ''. */
async function holderOf(db: Database, code: string, personId: string) {
  const rows = (await db.prepare(PARTNER_BLOCKED_SQL).all<{ code: string; src: string }>()).results ?? []
  const own = `partner:${personId}`
  for (const row of rows) {
    if (code9(row.code ?? '') !== code || row.src === own) continue
    if (row.src === 'taken') {
      const taken = await db.prepare('SELECT organisation FROM taken_sections WHERE section_code = ?').bind(code).first<{ organisation: string }>()
      // The person's own „И аз“ reservation (published here) is theirs.
      const mine = await db.prepare('SELECT 1 AS x FROM partner_people WHERE id = ? AND section_published = ?').bind(personId, code).first<{ x: number }>()
      if (mine) continue
      return `резервирана от ${taken?.organisation ?? 'друга организация'}`
    }
    if (row.src === 'signup') return 'наш записан човек'
    if (row.src === 'mobile') return 'цел на мобилен екип'
    return 'друг човек от „И аз“'
  }
  return ''
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

function changed(result: unknown) {
  if (!result || typeof result !== 'object') return true
  const changes = (result as { meta?: { changes?: unknown } }).meta?.changes
  return typeof changes === 'number' ? changes > 0 : true
}

import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { MANAGED_ORG, cleanOrg, describePlan, isManagedOrg, sameOrg, planReservations, reservedCode, type ReservationPlan, type ReserveMode } from './reserved-sections'
import { knownSectionCheck, loadAssignedPeople, loadConflicts, loadReservations, partnerHeldCodes } from './reserved-sections-db'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }
type ImportInput = { csv: string; org?: string; mode?: ReserveMode }

const MAX_ROWS = 15_000

/** Reserved sections, their organisations and our people already on them. */
export const adminReservedSections = createServerFn({ method: 'POST' }).handler(async () => {
  const access = await gate('view')
  if (!access.ok) return access
  const rows = await loadReservations(access.db)
  rows.sort((a, b) => a.organisation.localeCompare(b.organisation, 'bg') || a.sectionCode.localeCompare(b.sectionCode))
  const orgs = new Map<string, number>()
  for (const row of rows) orgs.set(row.organisation, (orgs.get(row.organisation) ?? 0) + 1)
  return {
    ok: true as const,
    rows: rows.map(({ sectionCode, organisation, note, place }) => ({ sectionCode, organisation, note: note ?? '', place: place ?? '', managed: isManagedOrg(organisation) })),
    orgs: [...orgs.entries()].map(([organisation, count]) => ({ organisation, count })),
    conflicts: await loadConflicts(access.db),
  }
})

/** Dry run: nothing is written. */
export const adminReservedPreview = createServerFn({ method: 'POST' })
  .validator((input: ImportInput) => cleanInput(input))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const plan = await buildPlan(access.db, data)
    return { ok: true as const, plan: summary(plan), message: planMessage(plan) }
  })

export const adminReservedCommit = createServerFn({ method: 'POST' })
  .validator((input: ImportInput) => cleanInput(input))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const plan = await buildPlan(db, data)
    if (plan.errors.length) return { ok: false as const, message: plan.errors[0], plan: summary(plan) }
    if (plan.rows.length === 0 && plan.remove.length === 0) return { ok: false as const, message: 'Няма валидни редове.', plan: summary(plan) }
    const now = new Date().toISOString()
    const statements = [
      ...plan.remove.map((row) => db.prepare(`DELETE FROM taken_sections WHERE section_code = ? AND organisation != '${MANAGED_ORG}'`).bind(row.sectionCode)),
      ...[...plan.add, ...plan.update, ...plan.moved].map((row) =>
        db
          .prepare(
            `INSERT INTO taken_sections (section_code, mir_code, place, organisation, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(section_code) DO UPDATE SET
               mir_code = excluded.mir_code,
               place = CASE WHEN excluded.place != '' THEN excluded.place ELSE taken_sections.place END,
               organisation = excluded.organisation,
               note = excluded.note
             WHERE taken_sections.organisation != '${MANAGED_ORG}'`,
          )
          .bind(row.sectionCode, row.sectionCode.slice(0, 2), row.place, row.organisation, row.note, now),
      ),
    ]
    // One batch is one transaction: a failed import leaves the previous list.
    for (let index = 0; index < statements.length; index += 5000) await db.batch(statements.slice(index, index + 5000))
    return {
      ok: true as const,
      plan: summary(plan),
      message: `Записано: ${describePlan(plan)}. Хората, които вече са там, не са махнати. Виж „Конфликти“.`,
    }
  })

/** Remove reservations by code, or every reservation of one organisation. */
export const adminReservedRemove = createServerFn({ method: 'POST' })
  .validator((input: { codes?: string[]; org?: string }) => ({
    codes: Array.isArray(input.codes) ? input.codes.slice(0, MAX_ROWS).map((code) => reservedCode(String(code))).filter(Boolean) : [],
    org: cleanOrg(typeof input.org === 'string' ? input.org : ''),
  }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    if (data.org && isManagedOrg(data.org)) {
      return { ok: false as const, message: 'Резервациите на „И аз“ се махат от разпределението „И аз“ в Секции (Махни публикуването).' }
    }
    if (data.org) {
      const codes = (await loadReservations(db)).filter((row) => sameOrg(row.organisation, data.org)).map((row) => row.sectionCode)
      if (codes.length === 0) return { ok: false as const, message: `Няма резервации на ${data.org}.` }
      for (let index = 0; index < codes.length; index += 5000) {
        await db.batch(codes.slice(index, index + 5000).map((code) => db.prepare(`DELETE FROM taken_sections WHERE section_code = ? AND organisation != '${MANAGED_ORG}'`).bind(code)))
      }
      return { ok: true as const, removed: codes.length, message: `Махнахме ${codes.length} резервации на ${data.org}.` }
    }
    if (data.codes.length === 0) return { ok: false as const, message: 'Няма секции за махане.' }
    const managed = new Set((await loadReservations(db)).filter((row) => isManagedOrg(row.organisation)).map((row) => row.sectionCode))
    const codes = data.codes.filter((code) => !managed.has(code))
    const kept = data.codes.length - codes.length
    if (codes.length === 0) return { ok: false as const, message: 'Тези резервации са на „И аз“. Махат се от разпределението „И аз“ в Секции.' }
    // Never an „И аз“ reservation, even if the code is listed: the partner allocation owns it.
    await db.batch(codes.map((code) => db.prepare(`DELETE FROM taken_sections WHERE section_code = ? AND organisation != '${MANAGED_ORG}'`).bind(code)))
    return {
      ok: true as const,
      removed: codes.length,
      message: `Махнахме резервацията на ${codes.join(', ')}.${kept ? ` ${kept} на „И аз“ не са махнати.` : ''}`,
    }
  })

function cleanInput(input: ImportInput) {
  return {
    csv: typeof input.csv === 'string' ? input.csv : '',
    org: cleanOrg(typeof input.org === 'string' ? input.org : ''),
    mode: input.mode === 'replace' ? ('replace' as const) : ('merge' as const),
  }
}

async function buildPlan(db: Database, data: { csv: string; org: string; mode: ReserveMode }) {
  if (data.csv.length > 2_000_000) {
    return planReservations({ csv: '', formOrg: data.org, mode: data.mode, existing: [], people: [], isKnown: () => true })
  }
  const plan = planReservations({
    csv: data.csv,
    formOrg: data.org,
    mode: data.mode,
    existing: await loadReservations(db),
    people: await loadAssignedPeople(db),
    isKnown: await knownSectionCheck(db),
    managed: await partnerHeldCodes(db),
  })
  if (plan.rows.length > MAX_ROWS) plan.errors.push(`Най-много ${MAX_ROWS} секции наведнъж.`)
  return plan
}

function planMessage(plan: ReservationPlan) {
  return plan.errors[0] ?? `Преглед (нищо не е записано): ${describePlan(plan)}.`
}

/** Counts plus short lists, so a big file does not flood the browser. */
function summary(plan: ReservationPlan) {
  return {
    mode: plan.mode,
    organisation: plan.organisation,
    valid: plan.rows.length,
    add: plan.add.length,
    update: plan.update.length,
    unchanged: plan.unchanged.length,
    moved: plan.moved.slice(0, 50).map((row) => ({ sectionCode: row.sectionCode, from: row.from, to: row.organisation })),
    movedCount: plan.moved.length,
    remove: plan.remove.slice(0, 50).map((row) => row.sectionCode),
    removeCount: plan.remove.length,
    unknown: plan.unknown.slice(0, 50),
    unknownCount: plan.unknown.length,
    invalid: plan.invalid.slice(0, 20),
    invalidCount: plan.invalid.length,
    duplicates: plan.duplicates.slice(0, 20),
    duplicateCount: plan.duplicates.length,
    conflicts: plan.conflicts.slice(0, 100),
    conflictCount: plan.conflicts.length,
    managed: plan.managed.slice(0, 50).map((row) => row.sectionCode),
    managedCount: plan.managed.length,
    orgs: [...new Set(plan.rows.map((row) => row.organisation))].slice(0, 20),
    errors: plan.errors,
  }
}

export type ReservedPreview = ReturnType<typeof summary>

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

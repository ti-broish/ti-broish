/**
 * „Поправи име/ЕГН“ server functions (admins): from a РИК task and from the person's page
 * (signup or „И аз“). The transition itself is applyIdentityFix in identity-fix.ts.
 */
import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'
import { isPartnerPersonId } from './partner-people-sql'
import { ensureRikTables } from './rik/sync'
import {
  EGN_TAKEN_SQL,
  FIX_STAGE_LABELS,
  applyIdentityFix,
  checkIdentityFix,
  ensureIdentityFixTables,
  fixStage,
  loadStoredIdentity,
  maskEgn,
  type StoredIdentity,
  SELF_TASK_TYPE,
} from './identity-fix'

type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

async function gate(action: StaffAction): Promise<{ ok: true; db: SignupD1; email: string; role: StaffRole } | Denial> {
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
  if (!roleAllows(role, action)) return { ok: false, state: 'forbidden', email, message: 'Само администратор може да поправя имена и ЕГН.' }
  await ensureRikTables(db)
  await ensureIdentityFixTables(db)
  return { ok: true, db, email, role }
}

export interface FixHistoryRow {
  supersededAt: string
  supersededBy: string
  reason: string
  signedAt: string | null
  url: string
  replacedUrl: string
  replacedAt: string | null
}

export interface IdentityFixInfo {
  ok: true
  canFix: boolean
  personId: string
  isPartner: boolean
  firstName: string
  middleName: string
  lastName: string
  egnMasked: string
  number: number | null
  mir: string
  withdrawn: boolean
  signedAt: string | null
  currentUrl: string
  fixedAt: string | null
  stage: string
  history: FixHistoryRow[]
}

function personId(value: unknown) {
  return String(value ?? '')
    .trim()
    .slice(0, 120)
}

async function infoFor(db: SignupD1, stored: StoredIdentity, canFix: boolean): Promise<IdentityFixInfo> {
  const fixed = await db
    .prepare(`SELECT MAX(created_at) AS at FROM designation_renames WHERE person_id = ? AND origin = 'identity_fix'`)
    .bind(stored.id)
    .first<{ at: string | null }>()
  const history = (
    await db
      .prepare(
        `SELECT superseded_at, superseded_by, reason, signed_at, pdf_url, COALESCE(replaced_by_url, '') AS replaced_by_url, replaced_at
         FROM designation_file_history WHERE person_id = ? ORDER BY superseded_at DESC LIMIT 20`,
      )
      .bind(stored.id)
      .all<{ superseded_at: string; superseded_by: string; reason: string; signed_at: string | null; pdf_url: string; replaced_by_url: string; replaced_at: string | null }>()
  ).results ?? []
  const fixedAt = fixed?.at ?? null
  const stage = fixStage({ fixedAt, signingGeneratedAt: stored.file.signingGeneratedAt, signedAt: stored.file.signedAt })
  return {
    ok: true,
    canFix,
    personId: stored.id,
    isPartner: stored.table === 'partner_people',
    firstName: stored.names.firstName,
    middleName: stored.names.middleName,
    lastName: stored.names.lastName,
    egnMasked: maskEgn(stored.egn),
    number: stored.file.number,
    mir: stored.file.mir,
    withdrawn: stored.withdrawn,
    signedAt: stored.file.signedAt,
    currentUrl: stored.file.pdfUrl ?? '',
    fixedAt,
    stage: stage ? FIX_STAGE_LABELS[stage] : '',
    history: history.map((row) => ({
      supersededAt: row.superseded_at,
      supersededBy: row.superseded_by,
      reason: row.reason,
      signedAt: row.signed_at,
      url: row.pdf_url,
      replacedUrl: row.replaced_by_url,
      replacedAt: row.replaced_at,
    })),
  }
}

export const identityFixInfo = createServerFn({ method: 'POST' })
  .validator((input: { personId: string }) => ({ personId: personId(input.personId) }))
  .handler(async ({ data }) => {
    const access = await gate('view')
    if (!access.ok) return access
    const stored = await loadStoredIdentity(access.db, isPartnerPersonId(data.personId) ? 'partner_people' : 'signups', data.personId)
    if (!stored) return { ok: false as const, state: 'forbidden' as const, email: access.email, message: 'Няма такъв човек.' }
    return infoFor(access.db, stored, roleAllows(access.role, 'fixIdentity'))
  })

export const identityFixSave = createServerFn({ method: 'POST' })
  .validator((input: { personId: string; taskId?: string | null; firstName: string; middleName: string; lastName: string; egn: string }) => ({
    personId: personId(input.personId),
    taskId: input.taskId ? String(input.taskId).slice(0, 200) : null,
    firstName: String(input.firstName ?? '').slice(0, 200),
    middleName: String(input.middleName ?? '').slice(0, 200),
    lastName: String(input.lastName ?? '').slice(0, 200),
    egn: String(input.egn ?? '').slice(0, 40),
  }))
  .handler(async ({ data }) => {
    const access = await gate('fixIdentity')
    if (!access.ok) return access
    const refuse = (message: string) => ({ ok: false as const, state: 'invalid' as const, email: access.email, message })
    const stored = await loadStoredIdentity(access.db, isPartnerPersonId(data.personId) ? 'partner_people' : 'signups', data.personId)
    if (!stored) return refuse('Няма такъв човек.')
    if (stored.file.number == null) return refuse('Човекът още няма номер на пълномощно: поправи данните с „Редактирай“.')
    if (stored.withdrawn) return refuse('Човекът е отписан: няма пълномощно за поправяне.')
    if (data.taskId) {
      const task = await access.db.prepare('SELECT person_id FROM rik_tasks WHERE id = ?').bind(data.taskId).first<{ person_id: string | null }>()
      if (!task || task.person_id !== stored.id) return refuse('Задачата не е за този човек.')
    }
    const check = checkIdentityFix(data, { ...stored.names, egn: stored.egn })
    if (!check.ok) return refuse(check.message)
    if (check.egnChanged) {
      const taken = await access.db.prepare(EGN_TAKEN_SQL).bind(check.after.egn, stored.id).first<{ id: string; mir: string; number: number }>()
      if (taken) return refuse(`Това ЕГН вече е на друг човек с пълномощно № ${taken.mir}/${taken.number}.`)
    }
    try {
      const result = await applyIdentityFix(access.db, { stored, after: check.after, actor: access.email, now: new Date().toISOString(), taskId: data.taskId })
      const fresh = await loadStoredIdentity(access.db, stored.table, stored.id)
      return { ...result, info: fresh ? await infoFor(access.db, fresh, true) : null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/UNIQUE/i.test(message)) return refuse('Това ЕГН вече е записано при друг човек от същия партньор.')
      throw error
    }
  })

/**
 * „Издай нов документ“ on a „Смяна име/ЕГН – нов документ“ task: the volunteer already saved the new
 * names/ЕГН; this resets the пълномощно (same number and МИР) for signing under them, keeps the old
 * file in the history and tracks the РИК correction from the task's old values. Sends nothing.
 */
export const identityReissue = createServerFn({ method: 'POST' })
  .validator((input: { taskId: string }) => ({ taskId: String(input.taskId ?? '').slice(0, 200) }))
  .handler(async ({ data }) => {
    const access = await gate('fixIdentity')
    if (!access.ok) return access
    const refuse = (message: string) => ({ ok: false as const, state: 'invalid' as const, email: access.email, message })
    const task = await access.db
      .prepare(`SELECT person_id, type, COALESCE(old_name, '') AS old_name, COALESCE(old_egn, '') AS old_egn, fixed_at, done_at FROM rik_tasks WHERE id = ?`)
      .bind(data.taskId)
      .first<{ person_id: string | null; type: string; old_name: string; old_egn: string; fixed_at: string | null; done_at: string | null }>()
    if (!task || task.type !== SELF_TASK_TYPE || !task.person_id) return refuse('Това не е задача „Смяна име/ЕГН – нов документ“.')
    if (task.done_at) return refuse('Задачата е готова.')
    if (task.fixed_at) return refuse('Новият документ вече е издаден по тази задача.')
    const stored = await loadStoredIdentity(access.db, isPartnerPersonId(task.person_id) ? 'partner_people' : 'signups', task.person_id)
    if (!stored) return refuse('Няма такъв човек.')
    if (stored.file.number == null) return refuse('Човекът няма номер на пълномощно.')
    if (stored.withdrawn) return refuse('Човекът е отписан: няма пълномощно за издаване.')
    const result = await applyIdentityFix(access.db, {
      stored,
      after: { ...stored.names, egn: stored.egn },
      actor: access.email,
      now: new Date().toISOString(),
      taskId: data.taskId,
      reissue: { oldName: task.old_name, oldEgn: task.old_egn },
    })
    return result
  })

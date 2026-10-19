import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { rosterWhere, type RosterView } from './admin-csv'
import { CALLBACK_CHUNK, CALLBACK_FILTER_CAP, callbackIds, chunkIds } from './admin-bulk'
import { searchClause } from './admin-search'
import { currentSearchEngine, isFtsError, useLikeSearch } from './db-search'
import {
  brevoOutcomeAuditSuffix,
  clipWithdrawNote,
  parseWithdrawReason,
  restoreAuditAfter,
  restoreAuditBefore,
  restoreMessage,
  restoreSql,
  unregisterMessage,
  unregisterSql,
  withdrawAuditAfter,
  withdrawAuditBefore,
  type BrevoListOutcome,
  type WithdrawReason,
} from './admin-unregister'
import { importContactsToList, readBrevoConfig, removeContactsFromList } from './brevo'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

const VIEWS: RosterView[] = ['all', 'finished', 'started', 'assigned', 'unassigned', 'abroad', 'calls', 'queue', 'mir', 'draft', 'withdrawn', 'iaz']

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
  return db.prepare(sql).bind(...binds)
}

async function writeAudit(db: Database, signupId: string, actor: string, field: 'withdrawn' | 'restored', before: string, after: string, at: string) {
  await db
    .prepare(`INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), signupId, actor, field, before, after, at)
    .run()
}

async function brevoRemoveBestEffort(email: string): Promise<BrevoListOutcome> {
  try {
    const config = readBrevoConfig()
    if ('missing' in config) return { ok: true, action: 'skipped', detail: `липсва ${config.missing}` }
    if (!config.listId) return { ok: true, action: 'skipped', detail: 'липсва BREVO_LIST_ID' }
    await removeContactsFromList(config, [email], config.listId)
    return { ok: true, action: 'removed', detail: `махнат от списък ${config.listId}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, action: 'removed', detail: message.slice(0, 200) }
  }
}

async function brevoAddBestEffort(email: string, firstName: string, lastName: string): Promise<BrevoListOutcome> {
  try {
    const config = readBrevoConfig()
    if ('missing' in config) return { ok: true, action: 'skipped', detail: `липсва ${config.missing}` }
    if (!config.listId) return { ok: true, action: 'skipped', detail: 'липсва BREVO_LIST_ID' }
    await importContactsToList(
      config,
      [{ email, attributes: { FIRSTNAME: firstName, LASTNAME: lastName } }],
      config.listId,
    )
    return { ok: true, action: 'added', detail: `добавен в списък ${config.listId}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, action: 'added', detail: message.slice(0, 200) }
  }
}

type TargetRow = {
  id: string
  email: string
  draft_section: string
  published_section: string
  first_name: string
  last_name: string
  withdrawn_reason: string
  withdrawn_note: string
}

async function unregisterOne(
  db: Database,
  actor: string,
  row: TargetRow,
  reason: WithdrawReason,
  note: string,
  now: string,
) {
  const result = await db
    .prepare(unregisterSql())
    .bind(now, actor, reason, note || null, now, row.id)
    .run()
  if (!rowChanged(result)) return { updated: false as const, brevo: null as BrevoListOutcome | null }
  const before = withdrawAuditBefore(row.draft_section, row.published_section)
  let after = withdrawAuditAfter(reason, note, row.draft_section, row.published_section)
  const brevo = await brevoRemoveBestEffort(row.email)
  after += brevoOutcomeAuditSuffix(brevo)
  await writeAudit(db, row.id, actor, 'withdrawn', before, after, now)
  return { updated: true as const, brevo }
}

export const adminUnregisterPerson = createServerFn({ method: 'POST' })
  .validator((input: { id?: string; reason?: string; note?: string }) => ({
    id: typeof input.id === 'string' ? input.id.trim().slice(0, 80) : '',
    reason: parseWithdrawReason(input.reason),
    note: clipWithdrawNote(input.note),
  }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    if (!/^[\w-]{1,80}$/.test(data.id)) return { ok: false as const, message: 'Няма такъв човек.' }
    if (!data.reason) return { ok: false as const, message: 'Избери причина за отписването.' }
    const row = await access.db
      .prepare(
        `SELECT id, email,
           COALESCE(draft_section, '') AS draft_section,
           COALESCE(published_section, '') AS published_section,
           COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
           COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
           COALESCE(withdrawn_reason, '') AS withdrawn_reason,
           COALESCE(withdrawn_note, '') AS withdrawn_note,
           COALESCE(withdrawn, 0) AS withdrawn
         FROM signups WHERE id = ?`,
      )
      .bind(data.id)
      .first<TargetRow & { withdrawn: number }>()
    if (!row) return { ok: false as const, message: 'Няма такъв човек.' }
    if (row.withdrawn === 1) return { ok: false as const, message: 'Този човек вече е отписан.' }
    const now = new Date().toISOString()
    const result = await unregisterOne(access.db, access.email, row, data.reason, data.note, now)
    if (!result.updated) return { ok: false as const, message: 'Този човек вече е отписан.' }
    return {
      ok: true as const,
      message: 'Отписахме човека. Мястото в секцията е свободно.',
      brevo: result.brevo,
    }
  })

export const adminRestorePerson = createServerFn({ method: 'POST' })
  .validator((input: { id?: string }) => ({
    id: typeof input.id === 'string' ? input.id.trim().slice(0, 80) : '',
  }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    if (!/^[\w-]{1,80}$/.test(data.id)) return { ok: false as const, message: 'Няма такъв човек.' }
    const row = await access.db
      .prepare(
        `SELECT id, email,
           COALESCE(draft_section, '') AS draft_section,
           COALESCE(published_section, '') AS published_section,
           COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
           COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
           COALESCE(withdrawn_reason, '') AS withdrawn_reason,
           COALESCE(withdrawn_note, '') AS withdrawn_note,
           COALESCE(withdrawn, 0) AS withdrawn
         FROM signups WHERE id = ?`,
      )
      .bind(data.id)
      .first<TargetRow & { withdrawn: number }>()
    if (!row) return { ok: false as const, message: 'Няма такъв човек.' }
    if (row.withdrawn !== 1) return { ok: false as const, message: 'Този човек не е отписан.' }

    const freed = await lastFreedSection(access.db, row.id)
    const now = new Date().toISOString()
    const result = await access.db.prepare(restoreSql()).bind(now, row.id).run()
    if (!rowChanged(result)) return { ok: false as const, message: 'Този човек не е отписан.' }

    const before = restoreAuditBefore(row.withdrawn_reason, row.withdrawn_note, freed)
    let after = restoreAuditAfter()
    const brevo = await brevoAddBestEffort(row.email, row.first_name, row.last_name)
    after += brevoOutcomeAuditSuffix(brevo)
    await writeAudit(access.db, row.id, access.email, 'restored', before, after, now)
    return {
      ok: true as const,
      message: restoreMessage(),
      previousSection: freed,
      brevo,
    }
  })

export const adminBulkUnregister = createServerFn({ method: 'POST' })
  .validator((input: { reason?: string; note?: string; scope?: string; ids?: unknown; view?: string; mir?: string; q?: string }) => {
    const picked = callbackIds(Array.isArray(input.ids) ? input.ids : [])
    return {
      reason: parseWithdrawReason(input.reason),
      note: clipWithdrawNote(input.note),
      scope: input.scope === 'filter' ? ('filter' as const) : ('ids' as const),
      ids: picked.ids,
      truncated: picked.truncated,
      view: typeof input.view === 'string' ? input.view : 'all',
      mir: typeof input.mir === 'string' ? input.mir.slice(0, 8) : '',
      q: typeof input.q === 'string' ? input.q.slice(0, 120) : '',
    }
  })
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    if (!data.reason) return { ok: false as const, message: 'Избери причина за отписването.' }
    const pending = 'COALESCE(withdrawn, 0) = 0'
    const collect = async (mode: 'fts' | 'like') => {
      if (data.scope === 'ids') {
        if (data.ids.length === 0) return { ids: [] as string[], capped: false }
        const marks = data.ids.map(() => '?').join(', ')
        const rows = await bound(access.db, `SELECT id FROM signups WHERE id IN (${marks}) AND ${pending}`, data.ids).all<{ id: string }>()
        return { ids: (rows.results ?? []).map((row) => row.id), capped: false }
      }
      const filter = rosterWhere(viewOf(data.view), data.mir)
      if ('error' in filter) return filter
      const search = searchClause(data.q, mode)
      const rows = await bound(
        access.db,
        `SELECT id FROM signups WHERE (${filter.clause}) AND (${search.clause}) AND ${pending} ORDER BY updated_at DESC LIMIT ?`,
        [...filter.binds, ...search.binds, CALLBACK_FILTER_CAP + 1],
      ).all<{ id: string }>()
      const found = (rows.results ?? []).map((row) => row.id)
      return { ids: found.slice(0, CALLBACK_FILTER_CAP), capped: found.length > CALLBACK_FILTER_CAP }
    }
    let targets: { ids: string[]; capped: boolean } | { error: string }
    try {
      targets = await collect(currentSearchEngine())
    } catch (error) {
      if (currentSearchEngine() === 'like' || !isFtsError(error)) throw error
      useLikeSearch()
      targets = await collect('like')
    }
    if ('error' in targets) return { ok: false as const, message: targets.error }

    const now = new Date().toISOString()
    let updated = 0
    for (const chunk of chunkIds(targets.ids, CALLBACK_CHUNK)) {
      if (chunk.length === 0) continue
      const marks = chunk.map(() => '?').join(', ')
      const rows = await bound(
        access.db,
        `SELECT id, email,
           COALESCE(draft_section, '') AS draft_section,
           COALESCE(published_section, '') AS published_section,
           COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
           COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
           COALESCE(withdrawn_reason, '') AS withdrawn_reason,
           COALESCE(withdrawn_note, '') AS withdrawn_note
         FROM signups WHERE id IN (${marks}) AND ${pending}`,
        chunk,
      ).all<TargetRow>()
      for (const row of rows.results ?? []) {
        const result = await unregisterOne(access.db, access.email, row, data.reason!, data.note, now)
        if (result.updated) updated += 1
      }
    }
    const message = unregisterMessage(updated, targets.capped)
    const limitNote = data.truncated ? ' Наведнъж минават до 200 избрани реда. За повече използвай целия изглед.' : ''
    return { ok: true as const, updated, capped: targets.capped, message: `${message}${limitNote}` }
  })

/** Volunteer clears their own withdrawal (self re-register). Does not restore a section. */
export const selfRestoreSignup = createServerFn({ method: 'POST' })
  .handler(async () => {
    const db = await signupDatabase()
    const token = getCookie(SESSION_COOKIE)
    if (!db || !token) return { ok: false as const, message: 'Влез в профила си.' }
    const row = await db
      .prepare(
        `SELECT id, email,
           COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
           COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
           COALESCE(withdrawn_reason, '') AS withdrawn_reason,
           COALESCE(withdrawn_note, '') AS withdrawn_note,
           COALESCE(withdrawn, 0) AS withdrawn
         FROM signups WHERE session_token = ?`,
      )
      .bind(token)
      .first<{
        id: string
        email: string
        first_name: string
        last_name: string
        withdrawn_reason: string
        withdrawn_note: string
        withdrawn: number
      }>()
    if (!row) return { ok: false as const, message: 'Влез в профила си.' }
    if (row.withdrawn !== 1) return { ok: false as const, message: 'Записването не е отписано.' }
    const freed = await lastFreedSection(db, row.id)
    const now = new Date().toISOString()
    const result = await db.prepare(restoreSql()).bind(now, row.id).run()
    if (!rowChanged(result)) return { ok: false as const, message: 'Записването не е отписано.' }
    const before = restoreAuditBefore(row.withdrawn_reason, row.withdrawn_note, freed)
    let after = restoreAuditAfter()
    const brevo = await brevoAddBestEffort(row.email, row.first_name, row.last_name)
    after += brevoOutcomeAuditSuffix(brevo)
    await writeAudit(db, row.id, row.email, 'restored', before, after, now)
    return { ok: true as const, message: 'Върнахме записването.' }
  })

async function lastFreedSection(db: Database, signupId: string) {
  const row = await db
    .prepare(
      `SELECT after_text FROM signup_audit
       WHERE signup_id = ? AND field = 'withdrawn'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(signupId)
    .first<{ after_text: string }>()
  if (!row?.after_text) return ''
  const published = row.after_text.match(/освободена публикувана\s+([A-Z0-9]+)/i)
  if (published?.[1]) return published[1]
  const draft = row.after_text.match(/освободена чернова\s+([A-Z0-9]+)/i)
  return draft?.[1] ?? ''
}

/** D1 reports meta.changes; when the field is missing, treat the write as applied. */
function rowChanged(result: unknown) {
  const changes = (result as { meta?: { changes?: unknown } })?.meta?.changes
  return typeof changes === 'number' ? changes > 0 : true
}

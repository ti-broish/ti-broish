import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { rosterWhere, type RosterView } from './admin-csv'
import { CALLBACK_CHUNK, CALLBACK_FILTER_CAP, callbackIds, chunkIds } from './admin-bulk'
import { searchClause } from './admin-search'
import { currentSearchEngine, isFtsError, useLikeSearch } from './db-search'
import { clipWithdrawNote, parseWithdrawReason, processedMessage, restoreMessage, unregisterMessage, type WithdrawReason } from './admin-unregister'
import { cleanupWithdrawnBrevo, releaseWithdrawnSections, restoreSignup, setWithdrawalProcessed, withdrawnCounts, withdrawSignup } from './withdrawal'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

const VIEWS: RosterView[] = ['all', 'finished', 'started', 'assigned', 'unassigned', 'abroad', 'calls', 'queue', 'mir', 'draft', 'withdrawn']

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
  return withdrawSignup(db, row, { actor, by: actor, reason, note, byAdmin: true }, now)
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

    const now = new Date().toISOString()
    const result = await restoreSignup(access.db, row, access.email, now, { firstName: row.first_name, lastName: row.last_name })
    if (!result.updated) return { ok: false as const, message: 'Този човек не е отписан.' }
    return {
      ok: true as const,
      message: restoreMessage(),
      previousSection: result.previousSection,
      brevo: result.brevo,
    }
  })

/** Отписан → „Обработен“ and back. One audit row per change; no email, no Brevo, no section change. */
export const adminSetWithdrawalProcessed = createServerFn({ method: 'POST' })
  .validator((input: { id?: string; processed?: boolean }) => ({
    id: typeof input.id === 'string' ? input.id.trim().slice(0, 80) : '',
    processed: input.processed === true,
  }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    if (!/^[\w-]{1,80}$/.test(data.id)) return { ok: false as const, message: 'Няма такъв човек.' }
    const now = new Date().toISOString()
    const result = await setWithdrawalProcessed(access.db, data.id, data.processed, access.email, now)
    if (!result.updated) return { ok: false as const, message: processedMessage(data.processed, false) }
    return {
      ok: true as const,
      message: processedMessage(data.processed, true),
      processedAt: data.processed ? now : '',
      processedBy: data.processed ? access.email : '',
      counts: await withdrawnCounts(access.db),
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
    // The profile autosave may have restored it a moment earlier (saveSignup → restoreSignup): that is a success,
    // not a reason for /profil to flip back to withdrawn and save a fresh withdrawal.
    if (row.withdrawn !== 1) return { ok: true as const, message: 'Записването е активно.' }
    const now = new Date().toISOString()
    const result = await restoreSignup(db, row, row.email, now, { firstName: row.first_name, lastName: row.last_name })
    if (!result.updated) return { ok: true as const, message: 'Записването е активно.' }
    return { ok: true as const, message: 'Върнахме записването.' }
  })

/**
 * Brevo cleanup for withdrawn people (idempotent): first frees any section a withdrawn person still holds,
 * then takes up to 25 not-yet-clean contacts out of every Brevo list and blanks their section fields.
 * No email, no campaign. Click again while „остават“ is above zero.
 */
export const adminCleanupWithdrawn = createServerFn({ method: 'POST' })
  .validator((input: { again?: boolean; since?: string } | undefined) => {
    const since = typeof input?.since === 'string' && !Number.isNaN(Date.parse(input.since)) ? new Date(input.since).toISOString() : ''
    return { again: input?.again === true, since }
  })
  .handler(async ({ data }) => {
  const access = await gate('edit')
  if (!access.ok) return access
  const now = new Date().toISOString()
  const { released } = await releaseWithdrawnSections(access.db, now)
  // „Почисти наново“: withdrawn people with a signed link, once per re-run. The server picks the run's start
  // (its own clock, never later than now); the page sends it back on the next click until none are left.
  const since = data.again ? (data.since && data.since < now ? data.since : now) : ''
  const result = await cleanupWithdrawnBrevo(access.db, access.email, now, undefined, 25, data.again ? { since } : undefined)
  const parts = [
    released ? `Освободени секции: ${released}.` : '',
    `Brevo: изчистени ${result.cleaned} от ${result.checked}.`,
    result.failed ? `Неизчистени ${result.failed} (виж историята на човека).` : '',
    result.left ? `Остават ${result.left}.` : 'Няма останали.',
  ]
  return { ok: true as const, released, ...result, since, message: parts.filter(Boolean).join(' ') }
  })

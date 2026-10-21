import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'
import { ABROAD_MIR, DEFAULT_FETCH_BUDGET, DOMESTIC_MIRS, mirLabel } from './rik/config'
import { STATUS_LABELS, TASK_LABELS, type RikStatus, type RikTaskType } from './rik/match'
import { nameKey } from './rik/normalize'
import { RIK_PROBLEM_STATUSES, rikPeopleWhere } from './rik/people-filter'
import { createRikSync, ensureRikTables } from './rik/sync'

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
  if (!roleAllows(role, action)) return { ok: false, state: 'forbidden', email, message: 'Тази роля няма това право.' }
  await ensureRikTables(db)
  return { ok: true, db, email, role }
}

export interface RikSourceRow {
  mir: string
  label: string
  name: string
  registerUrl: string
  phones: string
  email: string
  adapter: string
  health: string
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastChangeAt: string | null
  lastError: string
  failures: number
  pages: number
  batches: number
  ourEntries: number
  otherMatches: number
  people: number
  registered: number
  waiting: number
  problems: number
  openTasks: number
}

const PROBLEM_STATUSES = RIK_PROBLEM_STATUSES
const WAITING_STATUSES: RikStatus[] = ['pending', 'not_signed']

function quoted(list: string[]) {
  return list.map((item) => `'${item}'`).join(', ')
}

export const rikOverview = createServerFn({ method: 'POST' })
  .validator(() => ({}))
  .handler(async () => {
    const access = await gate('view')
    if (!access.ok) return access
    const db = access.db
    const sources = (await db.prepare(`SELECT * FROM rik_sources`).all<Record<string, unknown>>()).results ?? []
    const counts = (await db
      .prepare(
        `SELECT mir, COUNT(*) AS people,
           SUM(CASE WHEN status = 'registered' THEN 1 ELSE 0 END) AS registered,
           SUM(CASE WHEN status IN (${quoted(WAITING_STATUSES)}) THEN 1 ELSE 0 END) AS waiting,
           SUM(CASE WHEN status IN (${quoted(PROBLEM_STATUSES)}) THEN 1 ELSE 0 END) AS problems
         FROM rik_status WHERE status NOT IN ('withdrawn', 'duplicate') GROUP BY mir`,
      )
      .all<{ mir: string; people: number; registered: number; waiting: number; problems: number }>()).results ?? []
    const tasks = (await db.prepare(`SELECT mir, COUNT(*) AS n FROM rik_tasks WHERE active = 1 AND done_at IS NULL GROUP BY mir`).all<{ mir: string; n: number }>()).results ?? []
    const byStatus = (await db.prepare(`SELECT status, COUNT(*) AS n FROM rik_status GROUP BY status`).all<{ status: string; n: number }>()).results ?? []
    const byType = (await db.prepare(`SELECT type, COUNT(*) AS n FROM rik_tasks WHERE active = 1 AND done_at IS NULL GROUP BY type`).all<{ type: string; n: number }>()).results ?? []
    const lastRun = await db.prepare(`SELECT trigger, started_at, finished_at, fetched, changed, errors, note FROM rik_runs ORDER BY started_at DESC LIMIT 1`).first<Record<string, unknown>>()
    const countMap = new Map(counts.map((row) => [row.mir, row]))
    const taskMap = new Map(tasks.map((row) => [row.mir, Number(row.n)]))
    const sourceMap = new Map(sources.map((row) => [String(row.mir), row]))
    const rows: RikSourceRow[] = [...DOMESTIC_MIRS, ABROAD_MIR].map((mir) => {
      const source = sourceMap.get(mir) ?? {}
      const count = countMap.get(mir)
      const base = String(source.base_url ?? '')
      return {
        mir,
        label: mirLabel(mir),
        name: String(source.name ?? ''),
        registerUrl: base ? `${base}/registers/register_p` : '',
        phones: String(source.phones ?? ''),
        email: String(source.email ?? ''),
        adapter: String(source.adapter ?? ''),
        health: String(source.health ?? 'never'),
        lastAttemptAt: (source.last_attempt_at as string | null) ?? null,
        lastSuccessAt: (source.last_success_at as string | null) ?? null,
        lastChangeAt: (source.last_change_at as string | null) ?? null,
        lastError: String(source.last_error ?? ''),
        failures: Number(source.failures ?? 0),
        pages: Number(source.pages ?? 0),
        batches: Number(source.batches ?? 0),
        ourEntries: Number(source.our_entries ?? 0),
        otherMatches: Number(source.other_matches ?? 0),
        people: Number(count?.people ?? 0),
        registered: Number(count?.registered ?? 0),
        waiting: Number(count?.waiting ?? 0),
        problems: Number(count?.problems ?? 0),
        openTasks: taskMap.get(mir) ?? 0,
      }
    })
    return {
      ok: true as const,
      canEdit: roleAllows(access.role, 'edit'),
      sources: rows,
      statuses: Object.fromEntries(byStatus.map((row) => [row.status, Number(row.n)])),
      taskTypes: Object.fromEntries(byType.map((row) => [row.type, Number(row.n)])),
      lastRun: lastRun
        ? {
            trigger: String(lastRun.trigger),
            startedAt: String(lastRun.started_at),
            finishedAt: (lastRun.finished_at as string | null) ?? null,
            fetched: Number(lastRun.fetched),
            changed: Number(lastRun.changed),
            errors: Number(lastRun.errors),
            note: String(lastRun.note ?? ''),
          }
        : null,
    }
  })

export interface RikPersonRow {
  id: string
  source: 'signup' | 'partner'
  name: string
  mir: string
  number: number | null
  issuedOn: string
  status: RikStatus
  statusLabel: string
  statusSince: string
  detail: string
  otherMir: string
  otherParty: string
  rikName: string
  rikNumber: string
  sourceUrl: string
  tasks: number
}

const PEOPLE_SQL = `
SELECT s.person_id AS id, s.source, s.mir, s.number, s.status, s.status_since, s.detail, s.other_mir, s.other_party,
  COALESCE(e.name, '') AS rik_name, COALESCE(e.number_raw, '') AS rik_number, COALESCE(e.source_url, '') AS source_url,
  COALESCE(su.designation_issued_at, pp.designation_issued_at, '') AS issued_on,
  TRIM(COALESCE(json_extract(su.payload, '$.firstName'), pp.first_name, '') || ' ' || COALESCE(json_extract(su.payload, '$.middleName'), pp.middle_name, '') || ' ' || COALESCE(json_extract(su.payload, '$.lastName'), pp.last_name, '')) AS name,
  (SELECT COUNT(*) FROM rik_tasks t WHERE t.person_id = s.person_id AND t.active = 1 AND t.done_at IS NULL) AS tasks
FROM rik_status s
LEFT JOIN rik_entries e ON e.id = s.entry_id
LEFT JOIN signups su ON s.source = 'signup' AND su.id = s.person_id
LEFT JOIN partner_people pp ON s.source = 'partner' AND pp.id = s.person_id`

function personRow(row: Record<string, unknown>): RikPersonRow {
  const status = String(row.status) as RikStatus
  return {
    id: String(row.id),
    source: row.source === 'partner' ? 'partner' : 'signup',
    name: String(row.name ?? '').replace(/\s+/g, ' ').trim(),
    mir: String(row.mir),
    number: row.number == null ? null : Number(row.number),
    issuedOn: String(row.issued_on ?? ''),
    status,
    statusLabel: STATUS_LABELS[status] ?? status,
    statusSince: String(row.status_since ?? ''),
    detail: String(row.detail ?? ''),
    otherMir: String(row.other_mir ?? ''),
    otherParty: String(row.other_party ?? ''),
    rikName: String(row.rik_name ?? ''),
    rikNumber: String(row.rik_number ?? ''),
    sourceUrl: String(row.source_url ?? ''),
    tasks: Number(row.tasks ?? 0),
  }
}

const PAGE = 50

export const rikPeople = createServerFn({ method: 'POST' })
  .validator((input: { mir?: string; status?: string; q?: string; page?: number }) => ({
    mir: (input.mir ?? '').replace(/\D/g, '').slice(0, 2),
    status: (input.status ?? '').replace(/[^a-z_]/g, ''),
    q: (input.q ?? '').trim().slice(0, 80),
    page: Math.max(1, Math.min(500, Math.floor(Number(input.page) || 1))),
  }))
  .handler(async ({ data }) => {
    const access = await gate('view')
    if (!access.ok) return access
    const { where, binds } = rikPeopleWhere(data)
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
    const all = ((await access.db.prepare(`${PEOPLE_SQL}${clause} ORDER BY s.mir, s.number`).bind(...binds).all<Record<string, unknown>>()).results ?? []).map(personRow)
    const needle = data.q ? nameKey(data.q) : ''
    const digits = data.q.replace(/\D/g, '')
    const filtered = needle
      ? all.filter((row) => nameKey(row.name).includes(needle) || (digits !== '' && String(row.number ?? '') === digits))
      : all
    return {
      ok: true as const,
      total: filtered.length,
      people: filtered.slice((data.page - 1) * PAGE, data.page * PAGE),
    }
  })

export interface RikTaskRow {
  id: string
  personId: string | null
  personName: string
  isPartner: boolean
  mir: string
  type: RikTaskType
  typeLabel: string
  reason: string
  detail: string
  active: boolean
  createdAt: string
  doneAt: string | null
  doneBy: string
  phones: string
  registerUrl: string
  sourceUrl: string
}

export const rikTasks = createServerFn({ method: 'POST' })
  .validator((input: { mir?: string; type?: string; show?: string; page?: number }) => ({
    mir: (input.mir ?? '').replace(/\D/g, '').slice(0, 2),
    type: (input.type ?? '').replace(/[^a-z_]/g, ''),
    show: input.show === 'done' || input.show === 'all' ? input.show : 'open',
    page: Math.max(1, Math.min(500, Math.floor(Number(input.page) || 1))),
  }))
  .handler(async ({ data }) => {
    const access = await gate('view')
    if (!access.ok) return access
    const where: string[] = []
    const binds: unknown[] = []
    if (data.mir) {
      where.push('t.mir = ?')
      binds.push(data.mir.padStart(2, '0'))
    }
    if (data.type) {
      where.push('t.type = ?')
      binds.push(data.type)
    }
    if (data.show === 'open') where.push('t.active = 1 AND t.done_at IS NULL')
    if (data.show === 'done') where.push('t.done_at IS NOT NULL')
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
    const total = await access.db.prepare(`SELECT COUNT(*) AS n FROM rik_tasks t${clause}`).bind(...binds).first<{ n: number }>()
    const rows = (await access.db
      .prepare(
        `SELECT t.*, COALESCE(src.phones, '') AS phones, COALESCE(src.base_url, '') AS base_url, COALESCE(e.source_url, '') AS source_url,
           TRIM(COALESCE(json_extract(su.payload, '$.firstName'), pp.first_name, '') || ' ' || COALESCE(json_extract(su.payload, '$.middleName'), pp.middle_name, '') || ' ' || COALESCE(json_extract(su.payload, '$.lastName'), pp.last_name, '')) AS person_name
         FROM rik_tasks t
         LEFT JOIN rik_sources src ON src.mir = t.mir
         LEFT JOIN rik_status st ON st.person_id = t.person_id
         LEFT JOIN rik_entries e ON e.id = st.entry_id
         LEFT JOIN signups su ON su.id = t.person_id
         LEFT JOIN partner_people pp ON pp.id = t.person_id
         ${clause}
         ORDER BY t.done_at IS NOT NULL, t.active DESC, t.mir, t.type, t.created_at
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, PAGE, (data.page - 1) * PAGE)
      .all<Record<string, unknown>>()).results ?? []
    const tasks: RikTaskRow[] = rows.map((row) => {
      const type = String(row.type) as RikTaskType
      const base = String(row.base_url ?? '')
      return {
        id: String(row.id),
        personId: (row.person_id as string | null) ?? null,
        personName: String(row.person_name ?? '').replace(/\s+/g, ' ').trim(),
        isPartner: String(row.person_id ?? '').startsWith('pp-'),
        mir: String(row.mir),
        type,
        typeLabel: TASK_LABELS[type] ?? type,
        reason: String(row.reason),
        detail: String(row.detail),
        active: Number(row.active) === 1,
        createdAt: String(row.created_at),
        doneAt: (row.done_at as string | null) ?? null,
        doneBy: String(row.done_by ?? ''),
        phones: String(row.phones ?? ''),
        registerUrl: base ? `${base}/registers/register_p` : '',
        sourceUrl: String(row.source_url ?? ''),
      }
    })
    return { ok: true as const, canEdit: roleAllows(access.role, 'edit'), total: Number(total?.n ?? 0), tasks }
  })

export const rikTaskDone = createServerFn({ method: 'POST' })
  .validator((input: { id: string; done: boolean }) => ({ id: String(input.id ?? '').slice(0, 200), done: input.done === true }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const stamp = new Date().toISOString()
    const result = data.done
      ? await access.db.prepare('UPDATE rik_tasks SET done_at = ?, done_by = ? WHERE id = ?').bind(stamp, access.email, data.id).run()
      : await access.db.prepare('UPDATE rik_tasks SET done_at = NULL, done_by = NULL WHERE id = ?').bind(data.id).run()
    const changes = (result as { meta?: { changes?: number } }).meta?.changes
    if (changes === 0) return { ok: false as const, state: 'forbidden' as const, email: access.email, message: 'Задачата не е намерена.' }
    return { ok: true as const, doneAt: data.done ? stamp : null, doneBy: data.done ? access.email : '' }
  })

/** „Синхронизирай“: one РИК, or every РИК within the request budget. Only reads РИК sites. */
export const rikSyncNow = createServerFn({ method: 'POST' })
  .validator((input: { mir?: string }) => ({ mir: (input.mir ?? '').replace(/\D/g, '').slice(0, 2) }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const budget = Number((env as unknown as { RIK_SYNC_FETCH_BUDGET?: string }).RIK_SYNC_FETCH_BUDGET) || DEFAULT_FETCH_BUDGET
    const summary = await createRikSync(access.db, {
      trigger: 'manual',
      mirs: data.mir ? [data.mir.padStart(2, '0')] : undefined,
      force: true,
      budget: data.mir ? Math.min(budget, 80) : budget,
    }).run()
    return { ok: true as const, summary }
  })

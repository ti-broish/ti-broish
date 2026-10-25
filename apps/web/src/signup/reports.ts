import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import type { HomePlace } from './model'
import { validateCall, type CallInput, type StoredPhoto } from './reports-validate'

const COOKIE = 'tb_session'

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    secret TEXT NOT NULL,
    session_token TEXT,
    email TEXT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reports_session ON reports(session_token)`,
  `CREATE TABLE IF NOT EXISTS report_photos (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_report_photos_report ON report_photos(report_id)`,
]

interface ReportD1 {
  prepare(sql: string): {
    run(): Promise<unknown>
    bind(...values: unknown[]): {
      run(): Promise<unknown>
      first<T>(): Promise<T | null>
      all<T>(): Promise<{ results?: T[] }>
    }
  }
}

type ReportKind = 'violation' | 'protocol' | 'call'

interface ReportRow {
  id: string
  kind: ReportKind
  secret: string
  payload: string
  created_at: string
  photo_count?: number
}

async function database() {
  const db = (env as unknown as { DB?: ReportD1 }).DB
  if (!db) return null
  for (const sql of STATEMENTS) await db.prepare(sql).run()
  return db
}

function fail(message: string) {
  return { ok: false as const, message }
}

async function insertReport(
  db: ReportD1,
  kind: ReportKind,
  email: string,
  payload: unknown,
  photos: StoredPhoto[],
) {
  const id = crypto.randomUUID()
  const secret = crypto.randomUUID()
  const now = new Date().toISOString()
  const token = getCookie(COOKIE) || null
  await db
    .prepare(
      `INSERT INTO reports (id, kind, secret, session_token, email, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, kind, secret, token, email || null, JSON.stringify(payload), now)
    .run()
  try {
    for (const [position, photo] of photos.entries()) {
      await db
        .prepare(
          `INSERT INTO report_photos (id, report_id, position, content_type, data)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), id, position, photo.contentType, photo.data)
        .run()
    }
  } catch {
    await db.prepare('DELETE FROM report_photos WHERE report_id = ?').bind(id).run()
    await db.prepare('DELETE FROM reports WHERE id = ?').bind(id).run()
    return fail('Не успяхме да запазим снимките. Опитай пак.')
  }
  return { ok: true as const, id, secret }
}

// Signals and protocols are no longer written here. /signal and /protokol send them to the Ти Броиш API
// (violation-api.ts, protocol-api.ts) so the team sees them in upravitel and the protocols reach validation.
// Older violation and protocol rows stay readable below; the tables are kept.

export const submitCall = createServerFn({ method: 'POST' })
  .validator((input: CallInput) => input)
  .handler(async ({ data }) => {
    const db = await database()
    if (!db) return fail('Записът не е достъпен в момента. Опитай пак.')
    const parsed = validateCall(data)
    if (typeof parsed === 'string') return fail(parsed)
    return insertReport(db, 'call', parsed.payload.email, parsed.payload, [])
  })

export interface KnownReport {
  id: string
  secret: string
}

export interface ReportSummary {
  id: string
  kind: ReportKind
  createdAt: string
  title: string
  photoCount: number
}

function summary(row: ReportRow): ReportSummary {
  const payload = JSON.parse(row.payload) as { description?: string; note?: string; message?: string }
  const title =
    row.kind === 'violation'
      ? (payload.description ?? 'Сигнал')
      : row.kind === 'protocol'
        ? payload.note || 'Протокол'
        : payload.message || 'Обаждане'
  return {
    id: row.id,
    kind: row.kind,
    createdAt: row.created_at,
    title: title.slice(0, 140),
    photoCount: Number(row.photo_count ?? 0),
  }
}

export const listReports = createServerFn({ method: 'POST' })
  .validator((input: { known?: KnownReport[] }) => input)
  .handler(async ({ data }) => {
    const db = await database()
    if (!db) return { ok: false as const, items: [] as ReportSummary[] }
    const byId = new Map<string, ReportRow>()
    const token = getCookie(COOKIE)
    if (token) {
      const owned = await db
        .prepare(
          `SELECT r.id, r.kind, r.secret, r.payload, r.created_at,
                  (SELECT COUNT(*) FROM report_photos p WHERE p.report_id = r.id) AS photo_count
           FROM reports r WHERE r.session_token = ? ORDER BY r.created_at DESC LIMIT 50`,
        )
        .bind(token)
        .all<ReportRow>()
      for (const row of owned.results ?? []) byId.set(row.id, row)
    }
    for (const item of (data.known ?? []).slice(0, 40)) {
      if (!item?.id || !item.secret || byId.has(item.id)) continue
      const row = await db
        .prepare(
          `SELECT r.id, r.kind, r.secret, r.payload, r.created_at,
                  (SELECT COUNT(*) FROM report_photos p WHERE p.report_id = r.id) AS photo_count
           FROM reports r WHERE r.id = ? AND r.secret = ?`,
        )
        .bind(item.id, item.secret)
        .first<ReportRow>()
      if (row) byId.set(row.id, row)
    }
    const items = [...byId.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(summary)
    return { ok: true as const, items }
  })

export interface ReportDetail {
  id: string
  kind: ReportKind
  createdAt: string
  name: string
  email: string
  phone: string
  description: string
  note: string
  message: string
  place: HomePlace | null
  wantCall: boolean
  photos: string[]
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export const getReport = createServerFn({ method: 'POST' })
  .validator((input: { id: string; secret?: string }) => input)
  .handler(async ({ data }): Promise<ReportDetail | null> => {
    const db = await database()
    if (!db || !data.id) return null
    const row = await db
      .prepare('SELECT id, kind, secret, payload, created_at FROM reports WHERE id = ?')
      .bind(data.id)
      .first<ReportRow>()
    if (!row) return null
    const token = getCookie(COOKIE)
    const sessionOwns = token
      ? Boolean(
          await db
            .prepare('SELECT id FROM reports WHERE id = ? AND session_token = ?')
            .bind(data.id, token)
            .first<{ id: string }>(),
        )
      : false
    if (!sessionOwns && data.secret !== row.secret) return null
    const photos = await db
      .prepare('SELECT data FROM report_photos WHERE report_id = ? ORDER BY position ASC')
      .bind(data.id)
      .all<{ data: string }>()
    const payload = JSON.parse(row.payload) as {
      name?: unknown
      email?: unknown
      phone?: unknown
      description?: unknown
      note?: unknown
      message?: unknown
      place?: HomePlace | null
      wantCall?: unknown
    }
    return {
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      name: text(payload.name),
      email: text(payload.email),
      phone: text(payload.phone),
      description: text(payload.description),
      note: text(payload.note),
      message: text(payload.message),
      place: payload.place ?? null,
      wantCall: payload.wantCall === true,
      photos: (photos.results ?? []).map((photo) => `data:image/jpeg;base64,${photo.data}`),
    }
  })

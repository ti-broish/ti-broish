import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SignupD1 } from '../db-core'
import { createRikSync, type Fetcher } from './sync'

/**
 * The whole sync against a fake web and an in-memory SQLite standing in for D1.
 * node:sqlite ships with Node 22 (CI); older Node skips this file.
 */
interface SqliteStatement {
  run(...values: unknown[]): unknown
  get(...values: unknown[]): unknown
  all(...values: unknown[]): unknown[]
}
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}
const sqliteModule = 'node:sqlite'
const sqlite = (await import(/* @vite-ignore */ sqliteModule).catch(() => null)) as { DatabaseSync: new (path: string) => SqliteDatabase } | null

function d1(raw: SqliteDatabase): SignupD1 {
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => raw.prepare(sql).run(...values),
    first: async <T,>() => (raw.prepare(sql).get(...values) as T | undefined) ?? null,
    all: async <T,>() => ({ results: raw.prepare(sql).all(...values) as T[] }),
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async <T,>(statements: ReturnType<SignupD1['prepare']>[]) => {
      raw.exec('BEGIN')
      const out: unknown[] = []
      for (const one of statements) out.push(await one.run())
      raw.exec('COMMIT')
      return out as T[]
    },
  }
}

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const OURS = 'Инициативен комитет за издигане на кандидатурата на Андрей Атанасов Гюров за президент и Георги Димитров Кандев за вицепрезидент'
const BASE23 = 'https://rik23.cik.bg/pvr2026/registers/register_p'

function listPage(batches: Array<[number, string]>) {
  const rows = batches.map(([id, party], i) => `<tr><td>${i + 1}/20.10.2026</td><td><a href="/pvr2026/registers/register_p?id=${id}">${party}</a></td></tr>`).join('')
  return `<html><body><div class="col-md-8"><ul class="breadcrumb"></ul><table class="table table-striped"><thead><tr><th>№ по ред, дата</th><th>Партия</th></tr></thead><tbody>${rows}</tbody></table></div><div class="calendar-col"><table class="table"><tr><td>1</td><td>2</td></tr></table></div></body></html>`
}
function batchPage(party: string, rows: Array<[string, string]>, next?: string) {
  const body = rows.map(([name, number]) => `<tr><td>${name}</td><td>${number}</td></tr>`).join('')
  const pager = next ? `<ul class="pagination"><li><a href="${next}">2</a></li></ul>` : ''
  const empty = rows.length ? '' : '<p>В момента няма въведени данни в регистъра</p>'
  return `<html><body><div class="col-md-8"><ul class="breadcrumb"></ul><h4>${party}</h4>${empty}<table class="table table-striped"><thead><tr><th>Упълномощени представители</th><th>№ и дата на пълномощното</th></tr></thead><tbody>${body}</tbody></table>${pager}</div><div class="calendar-col"></div></body></html>`
}

function fakeWeb(pages: Map<string, { status: number; body: string }>) {
  const calls: string[] = []
  const emptyList = fixture('rik01-pvr2026-list-empty.html')
  const fetcher: Fetcher = async (url) => {
    calls.push(url)
    const hit = pages.get(url)
    if (hit) return new Response(hit.body, { status: hit.status })
    if (url === 'https://www.cik.bg/bg/pvr2026/rik') return new Response(fixture('cik-pvr2026-rik-index.html'))
    if (/rik\d\d\.cik\.bg\/pvr2026\/contacts$/.test(url)) return new Response(fixture('rik23-pvr2026-contacts.html'))
    if (/rik\d\d\.cik\.bg\/pvr2026\/registers\/(register_p|advocates)$/.test(url)) return new Response(emptyList)
    return new Response('not found', { status: 404 })
  }
  return { fetcher, calls }
}

function seed(raw: SqliteDatabase, start: number) {
  raw.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, payload TEXT NOT NULL, designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT,
    designation_signed_at TEXT, designation_first_signed_at TEXT, withdrawn INTEGER NOT NULL DEFAULT 0, sections TEXT NOT NULL DEFAULT '',
    egn TEXT NOT NULL DEFAULT '', published_section TEXT)`)
  raw.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, first_name TEXT, middle_name TEXT, last_name TEXT, designation_mir TEXT, designation_number INTEGER,
    designation_issued_at TEXT, designation_signed_at TEXT, designation_first_signed_at TEXT, egn TEXT NOT NULL DEFAULT '', withdrawn_at TEXT)`)
  const recent = new Date(start - 6 * 3600_000).toISOString()
  const old = new Date(start - 48 * 3600_000).toISOString()
  const people: Array<[string, string, number, string, number?]> = [
    ['a', 'Иван Петров Иванов', 501, recent],
    ['b', 'Мария Георгиева Колева', 502, recent],
    ['c', 'Петър Стоянов Димов', 503, recent],
    ['d', 'Елена Николова Маринова', 504, recent],
    ['e', 'Стоян Василев Тодоров', 505, old],
    ['f', 'Яна Данчева Василева', 506, recent],
    ['g', 'Борис Ангелов Пенев', 507, recent, 1],
  ]
  const insert = raw.prepare('INSERT INTO signups (id, payload, designation_mir, designation_number, designation_issued_at, designation_signed_at, withdrawn, sections) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (const [id, name, number, signed, withdrawn] of people) {
    const [firstName, middleName, lastName] = name.split(' ')
    insert.run(id, JSON.stringify({ firstName, middleName, lastName }), '23', number, '19.10.2026', signed, withdrawn ?? 0, '["230100001"]')
  }
  raw.prepare(`INSERT INTO partner_people (id, first_name, middle_name, last_name, designation_mir, designation_number, designation_issued_at,
    designation_signed_at, designation_first_signed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('pp-1', 'Ина', 'Иванова', 'Петрова', '24', 601, '19.10.2026', recent, null)
}

function snapshot(raw: SqliteDatabase) {
  return JSON.stringify([raw.prepare('SELECT * FROM signups ORDER BY id').all(), raw.prepare('SELECT * FROM partner_people ORDER BY id').all()])
}

describe.skipIf(!sqlite)('РИК sync end to end (fake web, in-memory D1)', () => {
  it('reads batches and pages, dedupes across them and across runs, and derives tasks', async () => {
    const raw = new sqlite!.DatabaseSync(':memory:')
    let clock = Date.parse('2026-10-22T09:00:00.000Z')
    seed(raw, clock)
    const before = snapshot(raw)
    const db = d1(raw)

    const pages = new Map<string, { status: number; body: string }>()
    const firstBatches = () => {
      pages.set(BASE23, { status: 200, body: listPage([[11, OURS], [12, 'ПП ДРУГА'], [13, OURS]]) })
      pages.set(`${BASE23}?id=11`, { status: 200, body: batchPage(OURS, [['Иван Петров Иванов', '501/19.10.2026'], ['ЯНА ДАНЧЕВА ВССИЛЕВА', '506/19.10.2026 г.'], ['Борис Ангелов Пенев', '507/19.10.2026']]) })
      pages.set(`${BASE23}?id=12`, { status: 200, body: batchPage('ПП ДРУГА', [['Елена Николова Маринова', '3/18.10.2026'], ['Непознат Човек Някой', '4/18.10.2026']]) })
      // A batch split over two pages, and a row repeated on both.
      pages.set(`${BASE23}?id=13`, { status: 200, body: batchPage(OURS, [['Мария Георгиева Колева', '№ 502 / 19.10.2026'], ['Иван Петров Иванов', '501/19.10.2026']], '/pvr2026/registers/register_p?id=13&page=2') })
      pages.set(`${BASE23}?id=13&page=2`, { status: 200, body: batchPage(OURS, [['Петър Стоянов Димов', '503/19.10.2026']]) })
    }
    firstBatches()
    pages.set('https://rik24.cik.bg/pvr2026/registers/register_p', { status: 503, body: '' })
    const web = fakeWeb(pages)
    const sync = (extra: Partial<Parameters<typeof createRikSync>[1]> = {}) =>
      createRikSync(db, { trigger: 'cron', now: () => new Date(clock), fetcher: web.fetcher, pauseMs: 0, ...extra }).run()

    const first = await sync()
    expect(first.errors).toBe(1)
    expect(first.statuses).toMatchObject({ registered: 3, other_party: 1, stale: 1, name_mismatch: 1, withdrawn_registered: 1, rik_unavailable: 1 })
    expect(first.tasks).toEqual({ remove_person: 2, call_rik: 1, fix_data: 1 })
    const entries = () => raw.prepare('SELECT ours, name, missing_since FROM rik_entries ORDER BY name').all() as Array<{ ours: number; name: string; missing_since: string | null }>
    // ours: 5 distinct rows (one repeated across pages); other party: only the one matching our people.
    expect(entries().filter((row) => row.ours === 1)).toHaveLength(5)
    expect(entries().filter((row) => row.ours === 0).map((row) => row.name)).toEqual(['Елена Николова Маринова'])
    const source = (mir: string) => raw.prepare('SELECT health, failures, pages, batches, our_entries, phones FROM rik_sources WHERE mir = ?').get(mir) as Record<string, unknown>
    expect(source('23')).toMatchObject({ health: 'ok', batches: 3, our_entries: 6 })
    expect(String(source('23').phones)).not.toBe('')
    expect(source('24')).toMatchObject({ health: 'error', failures: 1 })
    expect(source('32')).toMatchObject({ health: 'not_published' })
    expect(source('01')).toMatchObject({ health: 'empty' })
    expect((raw.prepare('SELECT COUNT(*) AS n FROM rik_sources').get() as { n: number }).n).toBe(32)

    // 30 minutes later: every РИК is too fresh, nothing is fetched.
    clock += 30 * 60_000
    const tooSoon = await sync()
    expect(tooSoon.fetched).toBe(0)
    expect(tooSoon.skipped).toHaveLength(32)

    // Two hours later, same content: no new rows, no change, the broken РИК fails again → check task.
    clock += 2 * 3600_000
    const second = await sync()
    expect(second.changed).toBe(0)
    expect(entries()).toHaveLength(6)
    expect(second.tasks).toEqual({ remove_person: 2, call_rik: 1, fix_data: 1, check_rik: 1 })
    // The other party's batch is not re-read within 6 h, its matched row stays.
    expect(web.calls.filter((url) => url === `${BASE23}?id=12`)).toHaveLength(1)
    expect(entries().every((row) => row.missing_since == null)).toBe(true)

    // The РИК merges batch 13 into 11 and empties 13: same people, no duplicates, nobody missing.
    clock += 2 * 3600_000
    pages.set(`${BASE23}?id=11`, {
      status: 200,
      body: batchPage(OURS, [
        ['Иван Петров Иванов', '501/19.10.2026'],
        ['ЯНА ДАНЧЕВА ВССИЛЕВА', '506/19.10.2026 г.'],
        ['Борис Ангелов Пенев', '507/19.10.2026'],
        ['Мария Георгиева Колева', '№ 502 / 19.10.2026'],
        ['Петър Стоянов Димов', '503/19.10.2026'],
        ['Стоян Василев Тодоров', '505/19.10.2026'],
      ]),
    })
    pages.set(`${BASE23}?id=13`, { status: 200, body: batchPage(OURS, []) })
    pages.delete(`${BASE23}?id=13&page=2`)
    pages.set('https://rik24.cik.bg/pvr2026/registers/register_p', { status: 200, body: listPage([[21, OURS]]) })
    pages.set('https://rik24.cik.bg/pvr2026/registers/register_p?id=21', { status: 200, body: batchPage(OURS, [['Ина Иванова Петрова', '601/19.10.2026']]) })
    const third = await sync()
    expect(third.statuses).toMatchObject({ registered: 5, other_party: 1, name_mismatch: 1, withdrawn_registered: 1 })
    expect(third.tasks).toEqual({ remove_person: 2, fix_data: 1 })
    expect(entries().filter((row) => row.ours === 1)).toHaveLength(7)
    expect(entries().every((row) => row.missing_since == null)).toBe(true)
    // Resolved tasks stay as history but inactive.
    const tasks = raw.prepare('SELECT id, active FROM rik_tasks ORDER BY id').all() as Array<{ id: string; active: number }>
    expect(tasks.find((task) => task.id === 'e:call_rik:not_published')?.active).toBe(0)
    expect(tasks.find((task) => task.id === 'rik:24:check_rik')?.active).toBe(0)
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length)

    // A row taken off the register is kept but marked missing, and the person goes back to waiting.
    clock += 2 * 3600_000
    pages.set(`${BASE23}?id=11`, { status: 200, body: batchPage(OURS, [['Иван Петров Иванов', '501/19.10.2026'], ['ЯНА ДАНЧЕВА ВССИЛЕВА', '506/19.10.2026 г.'], ['Борис Ангелов Пенев', '507/19.10.2026'], ['Мария Георгиева Колева', '№ 502 / 19.10.2026'], ['Петър Стоянов Димов', '503/19.10.2026']]) })
    const fourth = await sync()
    expect(entries().filter((row) => row.missing_since != null).map((row) => row.name)).toEqual(['Стоян Василев Тодоров'])
    expect(fourth.statuses.stale).toBe(1)

    // The sync never touches people.
    expect(snapshot(raw)).toBe(before)
  })

  it('stops politely at the request budget and carries on next time', async () => {
    const raw = new sqlite!.DatabaseSync(':memory:')
    const clock = Date.parse('2026-10-22T09:00:00.000Z')
    seed(raw, clock)
    const web = fakeWeb(new Map())
    const run = await createRikSync(d1(raw), { trigger: 'cron', now: () => new Date(clock), fetcher: web.fetcher, pauseMs: 0, budget: 7 }).run()
    expect(run.fetched).toBe(7)
    expect(run.synced.length).toBeGreaterThan(0)
    expect(run.synced.length).toBeLessThan(32)
    const note = raw.prepare('SELECT note FROM rik_runs').get() as { note: string }
    expect(note.note).toContain('Лимитът')
    const never = raw.prepare("SELECT COUNT(*) AS n FROM rik_sources WHERE last_attempt_at IS NULL").get() as { n: number }
    expect(never.n).toBe(32 - run.synced.length)
  })
})

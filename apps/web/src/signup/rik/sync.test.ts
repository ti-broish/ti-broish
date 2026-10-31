import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { SignupD1 } from '../db-core'
import { runScheduledRikSync } from './scheduled'
import { createRikSync, type Fetcher } from './sync'

vi.mock('cloudflare:workers', () => ({ env: {} }))
const noSleep = async () => {}

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
      createRikSync(db, { trigger: 'cron', now: () => new Date(clock), fetcher: web.fetcher, pauseMs: 0, sleep: noSleep, ...extra }).run()

    const first = await sync()
    expect(first.errors).toBe(1)
    // Елена's namesake on „ПП ДРУГА“ is never read or matched: she waits for our РИК like anyone.
    expect(first.statuses).toEqual({ registered: 3, pending: 1, stale: 1, name_mismatch: 1, withdrawn_registered: 1, rik_unavailable: 1 })
    expect(first.tasks).toEqual({ remove_person: 1, call_rik: 1, fix_data: 1 })
    const entries = () => raw.prepare('SELECT ours, name, missing_since FROM rik_entries ORDER BY name').all() as Array<{ ours: number; name: string; missing_since: string | null }>
    // ours: 5 distinct rows (one repeated across pages); another party's batch is not read at all.
    expect(entries().filter((row) => row.ours === 1)).toHaveLength(5)
    expect(entries().filter((row) => row.ours === 0)).toEqual([])
    expect(web.calls.filter((url) => url === `${BASE23}?id=12`)).toEqual([])
    const source = (mir: string) => raw.prepare('SELECT health, failures, pages, batches, our_entries, phones FROM rik_sources WHERE mir = ?').get(mir) as Record<string, unknown>
    expect(source('23')).toMatchObject({ health: 'ok', batches: 3, our_entries: 6 })
    expect(String(source('23').phones)).not.toBe('')
    // One failed run (503 even after the retries) is a warning, not yet an error.
    expect(source('24')).toMatchObject({ health: 'warning', failures: 1 })
    expect(source('32')).toMatchObject({ health: 'not_published' })
    expect(source('01')).toMatchObject({ health: 'empty' })
    expect((raw.prepare('SELECT COUNT(*) AS n FROM rik_sources').get() as { n: number }).n).toBe(32)

    // 5 minutes later (e.g. a manual run right after the cron): every РИК is too fresh, nothing is fetched.
    clock += 5 * 60_000
    const tooSoon = await sync()
    expect(tooSoon.fetched).toBe(0)
    expect(tooSoon.skipped).toHaveLength(32)

    // Two hours later, same content: no new rows, no change, the broken РИК fails again → check task.
    clock += 2 * 3600_000
    const second = await sync()
    expect(second.changed).toBe(0)
    expect(entries()).toHaveLength(5)
    expect(second.tasks).toEqual({ remove_person: 1, call_rik: 1, fix_data: 1, check_rik: 1 })
    expect(source('24')).toMatchObject({ health: 'error', failures: 2 })
    expect(web.calls.filter((url) => url === `${BASE23}?id=12`)).toEqual([])
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
    expect(third.statuses).toEqual({ registered: 5, pending: 1, name_mismatch: 1, withdrawn_registered: 1 })
    expect(third.tasks).toEqual({ remove_person: 1, fix_data: 1 })
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
    const run = await createRikSync(d1(raw), { trigger: 'cron', now: () => new Date(clock), fetcher: web.fetcher, pauseMs: 0, sleep: noSleep, budget: 7 }).run()
    expect(run.fetched).toBe(7)
    expect(run.synced.length).toBeGreaterThan(0)
    expect(run.synced.length).toBeLessThan(32)
    const note = raw.prepare('SELECT note FROM rik_runs').get() as { note: string }
    expect(note.note).toContain('Лимитът')
    const never = raw.prepare("SELECT COUNT(*) AS n FROM rik_sources WHERE last_attempt_at IS NULL").get() as { n: number }
    expect(never.n).toBe(32 - run.synced.length)
  })
})

const BASE24 = 'https://rik24.cik.bg/pvr2026/registers/register_p'
const CHALLENGE = fixture('cf-challenge-403.html')

describe.skipIf(!sqlite)('РИК sync resilience (retries, warning/error, blocks, run rows)', () => {
  function setup() {
    const raw = new sqlite!.DatabaseSync(':memory:')
    const clock = { now: Date.parse('2026-10-22T09:00:00.000Z') }
    seed(raw, clock.now)
    const pages = new Map<string, { status: number; body: string }>()
    pages.set(BASE24, { status: 200, body: listPage([[21, OURS]]) })
    pages.set(`${BASE24}?id=21`, { status: 200, body: batchPage(OURS, [['Ина Иванова Петрова', '601/19.10.2026']]) })
    const web = fakeWeb(pages)
    const sleeps: number[] = []
    const sleep = async (ms: number) => void sleeps.push(ms)
    const db = d1(raw)
    const sync = (extra: Partial<Parameters<typeof createRikSync>[1]> = {}) =>
      createRikSync(db, { trigger: 'cron', now: () => new Date(clock.now), fetcher: web.fetcher, pauseMs: 0, sleep, ...extra }).run()
    const source = (mir: string) => raw.prepare('SELECT health, failures, last_error, last_good_health, blocked_until FROM rik_sources WHERE mir = ?').get(mir) as Record<string, unknown>
    const status = (id: string) => raw.prepare('SELECT status, checked_at FROM rik_status WHERE person_id = ?').get(id) as { status: string; checked_at: string } | undefined
    const run = (id: string) => raw.prepare('SELECT status, note, finished_at, fetched, errors FROM rik_runs WHERE id = ?').get(id) as Record<string, unknown>
    return { raw, clock, pages, web, sleeps, db, sync, source, status, run }
  }

  it('retries 5xx (520) and network errors with 1 s / 3 s / 8 s backoff, then reads the page', async () => {
    const t = setup()
    let failures = 0
    const flaky: Fetcher = async (url, init) => {
      if (url === BASE24 && failures < 2) {
        failures += 1
        return new Response('<html>origin error</html>', { status: 520 })
      }
      if (url === `${BASE24}?id=21` && failures === 2) {
        failures += 1
        throw new TypeError('Network connection lost.')
      }
      return t.web.fetcher(url, init)
    }
    const summary = await t.sync({ fetcher: flaky })
    expect(summary.retries).toBe(3)
    expect(t.sleeps).toEqual([1000, 3000, 1000])
    expect(summary.errors).toBe(0)
    expect(t.source('24')).toMatchObject({ health: 'ok', failures: 0, last_good_health: 'ok' })
    expect(t.status('pp-1')?.status).toBe('registered')
    expect(t.run(summary.runId)).toMatchObject({ status: 'ok' })
  })

  it('a failing РИК is a warning on the first failed run and an error after two, and keeps its last good data', async () => {
    const t = setup()
    await t.sync()
    expect(t.status('pp-1')?.status).toBe('registered')
    const entries = () => t.raw.prepare("SELECT name, missing_since FROM rik_entries WHERE mir = '24'").all() as Array<{ missing_since: string | null }>
    expect(entries()).toHaveLength(1)

    t.pages.set(BASE24, { status: 520, body: '' })
    t.clock.now += 60 * 60_000
    t.sleeps.length = 0
    const first = await t.sync()
    expect(t.sleeps).toEqual([1000, 3000, 8000])
    expect(first.errors).toBe(1)
    expect(t.source('24')).toMatchObject({ health: 'warning', failures: 1, last_good_health: 'ok' })
    expect(String(t.source('24').last_error)).toContain('HTTP 520')
    expect(first.status).toBe('partial')
    // Last good data still counts: the entry is kept, not missing, and the person stays registered.
    expect(entries()).toEqual([expect.objectContaining({ missing_since: null })])
    expect(t.status('pp-1')?.status).toBe('registered')
    expect(first.tasks.check_rik ?? 0).toBe(0)

    t.clock.now += 60 * 60_000
    const second = await t.sync()
    expect(t.source('24')).toMatchObject({ health: 'error', failures: 2 })
    expect(second.tasks.check_rik).toBe(1)
    expect(entries()).toEqual([expect.objectContaining({ missing_since: null })])

    // Back to normal: health and failures reset.
    t.pages.set(BASE24, { status: 200, body: listPage([[21, OURS]]) })
    t.clock.now += 60 * 60_000
    await t.sync()
    expect(t.source('24')).toMatchObject({ health: 'ok', failures: 0 })
  })

  it('a warning with no good read yet counts as „РИК не се чете“', async () => {
    const t = setup()
    t.pages.set(BASE24, { status: 503, body: '' })
    await t.sync()
    expect(t.source('24')).toMatchObject({ health: 'warning', last_good_health: '' })
    expect(t.status('pp-1')?.status).toBe('rik_unavailable')
  })

  it('a challenge page is „blocked“: never parsed, data and tasks untouched, the host is left alone next run', async () => {
    const t = setup()
    const BASE23 = 'https://rik23.cik.bg/pvr2026/registers/register_p'
    t.pages.set(BASE23, { status: 200, body: listPage([[11, OURS]]) })
    t.pages.set(`${BASE23}?id=11`, { status: 200, body: batchPage(OURS, [['Иван Петров Иванов', '501/19.10.2026']]) })
    await t.sync()
    const tasks23 = () => t.raw.prepare("SELECT id, active, updated_at FROM rik_tasks WHERE mir = '23' ORDER BY id").all()
    const status23 = () => t.raw.prepare("SELECT person_id, status, checked_at FROM rik_status WHERE mir = '23' ORDER BY person_id").all()
    const entries23 = () => t.raw.prepare("SELECT id, missing_since, last_seen_at FROM rik_entries WHERE mir = '23' ORDER BY id").all()
    const before = JSON.stringify([tasks23(), status23(), entries23()])
    expect(t.status('a')?.status).toBe('registered')
    expect((tasks23() as unknown[]).length).toBeGreaterThan(0)

    // Cloudflare's managed challenge (real page, sanitised): 403 + cf-mitigated.
    const challenge: Fetcher = async (url, init) =>
      url.startsWith('https://rik23.') ? new Response(CHALLENGE, { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } }) : t.web.fetcher(url, init)
    t.clock.now += 60 * 60_000
    t.sleeps.length = 0
    const blockedRun = await t.sync({ fetcher: challenge })
    expect(blockedRun.blocked).toEqual(['23'])
    expect(t.sleeps).toEqual([]) // a block is not retried
    expect(t.source('23')).toMatchObject({ health: 'blocked', failures: 0, last_good_health: 'ok' })
    expect(String(t.source('23').last_error)).toContain('Блокиран от сайта')
    expect(Date.parse(String(t.source('23').blocked_until))).toBe(t.clock.now + 100 * 60_000)
    // Only one request went to the blocked host (no advocates, no contacts after the block).
    expect(t.web.calls.filter((url) => url.startsWith('https://rik23.')).length).toBeGreaterThan(0)
    expect(JSON.stringify([tasks23(), status23(), entries23()])).toBe(before)

    // The next hourly run leaves the host alone; the one after reads it again.
    const calls = () => t.web.calls.filter((url) => url.startsWith('https://rik23.')).length
    let hits = 0
    const counting: Fetcher = async (url, init) => {
      if (url.startsWith('https://rik23.')) hits += 1
      return t.web.fetcher(url, init)
    }
    t.clock.now += 60 * 60_000
    const skipped = await t.sync({ fetcher: counting })
    expect(hits).toBe(0)
    expect(skipped.skipped).toContain('23')
    expect(JSON.stringify([tasks23(), status23(), entries23()])).toBe(before)
    t.clock.now += 60 * 60_000
    await t.sync({ fetcher: counting })
    expect(hits).toBeGreaterThan(0)
    expect(calls()).toBeGreaterThan(0)
    expect(t.source('23')).toMatchObject({ health: 'ok', blocked_until: null })
  })

  it('a 200 interstitial is blocked too, never read as an empty register', async () => {
    const t = setup()
    await t.sync()
    const interstitial: Fetcher = async (url, init) => (url === BASE24 ? new Response(CHALLENGE, { status: 200 }) : t.web.fetcher(url, init))
    t.clock.now += 60 * 60_000
    await t.sync({ fetcher: interstitial })
    expect(t.source('24')).toMatchObject({ health: 'blocked', last_good_health: 'ok' })
    expect(t.status('pp-1')?.status).toBe('registered')
    const entry = t.raw.prepare("SELECT missing_since FROM rik_entries WHERE mir = '24'").get() as { missing_since: string | null }
    expect(entry.missing_since).toBeNull()
  })

  it('stops after a few blocked РИК in one run instead of knocking on every host', async () => {
    const t = setup()
    const everywhere: Fetcher = async (url) => (url.includes('www.cik.bg') ? t.web.fetcher(url) : new Response('', { status: 429, headers: { 'retry-after': '7200' } }))
    const summary = await t.sync({ fetcher: everywhere })
    expect(summary.blocked).toHaveLength(3)
    expect(summary.fetched).toBe(4) // the index + one request to each of the 3 blocked hosts
    const row = t.run(summary.runId)
    expect(String(row.note)).toContain('блокира')
    // Retry-After (2 h) is longer than the default back-off, so it wins.
    const first = t.raw.prepare("SELECT blocked_until FROM rik_sources WHERE health = 'blocked' LIMIT 1").get() as { blocked_until: string }
    expect(Date.parse(first.blocked_until)).toBe(t.clock.now + 7200_000)
  })

  it('a run that throws still leaves its rik_runs row, marked failed with the error', async () => {
    const t = setup()
    const broken: SignupD1 = {
      ...t.db,
      prepare: (sql: string) => {
        if (/FROM signups/.test(sql)) throw new Error('D1_ERROR: boom')
        return t.db.prepare(sql)
      },
    }
    await expect(createRikSync(broken, { trigger: 'manual', fetcher: t.web.fetcher, pauseMs: 0, sleep: noSleep }).run()).rejects.toThrow('boom')
    const rows = t.raw.prepare('SELECT status, note, finished_at FROM rik_runs').all() as Array<{ status: string; note: string; finished_at: string | null }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'failed' })
    expect(rows[0]!.note).toContain('D1_ERROR: boom')
    expect(rows[0]!.finished_at).not.toBeNull()
  })

  it('the cron waits out a busy D1 (long-running export), writes its row first and marks it failed if the run throws', async () => {
    const t = setup()
    let refusals = 2
    const busy: SignupD1 = {
      ...t.db,
      prepare: (sql: string) => {
        if (refusals > 0) {
          refusals -= 1
          throw new Error('D1_ERROR: Currently processing a long-running export.')
        }
        return t.db.prepare(sql)
      },
    }
    const sleeps: number[] = []
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await runScheduledRikSync('7 * * * *', {
      db: busy,
      ready: async () => {
        throw new Error('D1_ERROR: schema step failed')
      },
      sleep: async (ms) => void sleeps.push(ms),
      d1RetryDelaysMs: [5, 15],
    })
    expect(sleeps.slice(0, 2)).toEqual([5, 15])
    const rows = t.raw.prepare('SELECT trigger, status, note FROM rik_runs').all() as Array<{ trigger: string; status: string; note: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ trigger: 'cron', status: 'failed' })
    expect(rows[0]!.note).toContain('schema step failed')
  })

  it('the cron records a normal run end to end', async () => {
    const t = setup()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await runScheduledRikSync('7 * * * *', { db: t.db, ready: async () => t.db, now: () => new Date(t.clock.now), sync: { fetcher: t.web.fetcher, pauseMs: 0, sleep: noSleep, now: () => new Date(t.clock.now) } })
    const rows = t.raw.prepare('SELECT status, fetched, finished_at FROM rik_runs').all() as Array<{ status: string; fetched: number; finished_at: string | null }>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('ok')
    expect(rows[0]!.fetched).toBeGreaterThan(0)
  })

  it('the cron records runs missed on the 15-min schedule, and none for a normal 15-min gap', async () => {
    const t = setup()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const run = () =>
      runScheduledRikSync('7,22,37,52 * * * *', { db: t.db, ready: async () => t.db, now: () => new Date(t.clock.now), sync: { fetcher: t.web.fetcher, pauseMs: 0, sleep: noSleep, now: () => new Date(t.clock.now) } })
    const missed = () => t.raw.prepare("SELECT started_at, note FROM rik_runs WHERE status = 'missed'").all() as Array<{ started_at: string; note: string }>
    await run()
    const first = t.clock.now
    t.clock.now += 15 * 60_000
    await run()
    expect(missed()).toEqual([])
    // :37 and :52 never reached D1; the :07 run sees a 45-minute gap.
    t.clock.now += 45 * 60_000
    await run()
    expect(missed()).toEqual([{ started_at: new Date(first + 30 * 60_000).toISOString(), note: expect.stringContaining('Пропуснати пускания: 2') }])
  })
})

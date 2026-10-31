import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { SignupD1 } from '../db-core'
import { canCheckInRik } from './people-filter'
import { checkPersonInRik } from './person-check'
import { createRikSync, type Fetcher } from './sync'

vi.mock('cloudflare:workers', () => ({ env: {} }))
const noSleep = async () => {}

// Same in-memory SQLite stand-in for D1 as sync.test.ts (node:sqlite, Node 22+).
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
const REG = (mir: string) => `https://rik${mir}.cik.bg/pvr2026/registers/register_p`

function listPage(batches: Array<[number, string]>) {
  const rows = batches.map(([id, party], i) => `<tr><td>${i + 1}/20.10.2026</td><td><a href="/pvr2026/registers/register_p?id=${id}">${party}</a></td></tr>`).join('')
  return `<html><body><div class="col-md-8"><ul class="breadcrumb"></ul><table class="table table-striped"><thead><tr><th>№ по ред, дата</th><th>Партия</th></tr></thead><tbody>${rows}</tbody></table></div><div class="calendar-col"><table class="table"><tr><td>1</td><td>2</td></tr></table></div></body></html>`
}
function batchPage(party: string, rows: Array<[string, string]>) {
  const body = rows.map(([name, number]) => `<tr><td>${name}</td><td>${number}</td></tr>`).join('')
  return `<html><body><div class="col-md-8"><ul class="breadcrumb"></ul><h4>${party}</h4><table class="table table-striped"><thead><tr><th>Упълномощени представители</th><th>№ и дата на пълномощното</th></tr></thead><tbody>${body}</tbody></table></div><div class="calendar-col"></div></body></html>`
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

/** МИР 23: Иван (published), Мария (signed 48 h ago, not published → call_rik). МИР 24: Стоян (same, call_rik). */
function seed(raw: SqliteDatabase, start: number) {
  raw.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, payload TEXT NOT NULL, designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT,
    designation_signed_at TEXT, designation_first_signed_at TEXT, withdrawn INTEGER NOT NULL DEFAULT 0, sections TEXT NOT NULL DEFAULT '',
    egn TEXT NOT NULL DEFAULT '', published_section TEXT)`)
  raw.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, first_name TEXT, middle_name TEXT, last_name TEXT, designation_mir TEXT, designation_number INTEGER,
    designation_issued_at TEXT, designation_signed_at TEXT, designation_first_signed_at TEXT, egn TEXT NOT NULL DEFAULT '', withdrawn_at TEXT)`)
  const old = new Date(start - 48 * 3600_000).toISOString()
  const insert = raw.prepare('INSERT INTO signups (id, payload, designation_mir, designation_number, designation_issued_at, designation_signed_at, sections) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const [id, name, mir, number] of [
    ['a', 'Иван Петров Иванов', '23', 501],
    ['b', 'Мария Георгиева Колева', '23', 502],
    ['c', 'Стоян Василев Тодоров', '24', 601],
  ] as const) {
    const [firstName, middleName, lastName] = name.split(' ')
    insert.run(id, JSON.stringify({ firstName, middleName, lastName }), mir, number, '19.10.2026', old, '[]')
  }
}

async function setup() {
  const raw = new sqlite!.DatabaseSync(':memory:')
  let clock = Date.parse('2026-10-31T09:00:00.000Z')
  seed(raw, clock)
  const db = d1(raw)
  const pages = new Map<string, { status: number; body: string }>()
  pages.set(REG('23'), { status: 200, body: listPage([[11, OURS]]) })
  pages.set(`${REG('23')}?id=11`, { status: 200, body: batchPage(OURS, [['Иван Петров Иванов', '501/19.10.2026']]) })
  pages.set(REG('24'), { status: 200, body: listPage([[21, OURS]]) })
  pages.set(`${REG('24')}?id=21`, { status: 200, body: batchPage(OURS, [['Друг Наш Човек', '600/19.10.2026']]) })
  const web = fakeWeb(pages)
  const opts = { now: () => new Date(clock), fetcher: web.fetcher, pauseMs: 0, sleep: noSleep }
  // The cron's full run first.
  await createRikSync(db, { trigger: 'cron', ...opts }).run()
  const status = (id: string) => (raw.prepare('SELECT status, checked_at FROM rik_status WHERE person_id = ?').get(id) as { status: string; checked_at: string } | undefined)
  const tasks = (mir: string) =>
    raw.prepare('SELECT id, type, active, updated_at FROM rik_tasks WHERE mir = ? ORDER BY id').all(mir) as Array<{ id: string; type: string; active: number; updated_at: string }>
  return {
    raw,
    db,
    pages,
    web,
    opts,
    status,
    tasks,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('canCheckInRik', () => {
  it('shows the button for anyone not published yet, never for published, отписан or дубликат', () => {
    for (const status of ['pending', 'stale', 'not_signed', 'name_mismatch', 'number_mismatch', 'annulled', 'elsewhere', 'rik_unavailable', 'renamed', 'taken_external']) {
      expect(canCheckInRik(status)).toBe(true)
    }
    for (const status of ['registered', 'withdrawn_registered', 'withdrawn', 'duplicate']) expect(canCheckInRik(status)).toBe(false)
  })
})

describe.skipIf(!sqlite)('„Провери в РИК“ for one person', () => {
  it('reads only that РИК, updates that person and leaves every other РИК’s statuses and tasks alone', async () => {
    const t = await setup()
    expect(t.status('b')?.status).toBe('stale')
    expect(t.status('c')?.status).toBe('stale')
    expect(t.tasks('23').filter((task) => task.active)).toHaveLength(1)
    const before24 = t.tasks('24')
    expect(before24.filter((task) => task.active)).toHaveLength(1)
    // A task in МИР 24 the matcher would not derive now: a full rematch would deactivate it.
    t.raw.prepare(`INSERT INTO rik_tasks (id, person_id, mir, type, reason, detail, active, created_at, updated_at) VALUES ('x24', NULL, '24', 'check_rik', 'test', '', 1, ?, ?)`).run('2026-10-30T00:00:00.000Z', '2026-10-30T00:00:00.000Z')
    const status24 = t.status('c')

    // Мария shows up in РИК 23; Стоян shows up in РИК 24 too, but only 23 is checked.
    t.pages.set(`${REG('23')}?id=11`, { status: 200, body: batchPage(OURS, [['Иван Петров Иванов', '501/19.10.2026'], ['Мария Георгиева Колева', '502/19.10.2026']]) })
    t.pages.set(`${REG('24')}?id=21`, { status: 200, body: batchPage(OURS, [['Стоян Василев Тодоров', '601/19.10.2026']]) })
    t.advance(20 * 60_000)
    t.web.calls.length = 0

    const result = await checkPersonInRik(t.db, 'b', t.opts)
    expect(result).toMatchObject({ ok: true, outcome: 'fetched', mir: '23', status: 'registered', published: true, message: 'Проверено: публикуван.' })
    // One РИК, представители only: no CIK index, no застъпници, no contacts, nothing of РИК 24.
    expect(t.web.calls.every((url) => url.startsWith(REG('23')))).toBe(true)
    expect(t.web.calls).toContain(`${REG('23')}?id=11`)

    expect(t.status('b')?.status).toBe('registered')
    expect(t.tasks('23').filter((task) => task.active)).toHaveLength(0)
    // РИК 24 untouched: Стоян still stale (same row, same checked_at), its tasks as they were.
    expect(t.status('c')).toEqual(status24)
    expect(t.tasks('24').filter((task) => task.id !== 'x24')).toEqual(before24)
    expect(t.tasks('24').find((task) => task.id === 'x24')?.active).toBe(1)

    const run = t.raw.prepare(`SELECT trigger, status, fetched, note FROM rik_runs WHERE id = ?`).get((result as { runId: string }).runId) as Record<string, unknown>
    expect(run).toMatchObject({ trigger: 'manual_person', status: 'ok' })
    expect(Number(run.fetched)).toBeGreaterThan(0)
    expect(JSON.parse(String(run.note)).mirs).toEqual(['23'])

    // The next full run still does its job for РИК 24.
    t.advance(3 * 60 * 60_000)
    await createRikSync(t.db, { trigger: 'cron', ...t.opts }).run()
    expect(t.status('c')?.status).toBe('registered')
    expect(t.tasks('24').find((task) => task.id === 'x24')?.active).toBe(0)
  })

  it('still not published: says so and keeps the call_rik task', async () => {
    const t = await setup()
    t.advance(20 * 60_000)
    const result = await checkPersonInRik(t.db, 'b', t.opts)
    expect(result).toMatchObject({ ok: true, outcome: 'fetched', status: 'stale', published: false, message: 'Проверено: още не е публикуван.' })
    expect(t.tasks('23').filter((task) => task.active && task.type === 'call_rik')).toHaveLength(1)
  })

  it('throttles per РИК: a РИК read under a minute ago is not fetched again, the stored result is returned', async () => {
    const t = await setup()
    t.advance(20 * 60_000)
    await checkPersonInRik(t.db, 'b', t.opts)
    const runs = () => Number((t.raw.prepare('SELECT COUNT(*) AS n FROM rik_runs').get() as { n: number }).n)
    const runsBefore = runs()
    t.web.calls.length = 0

    t.advance(30_000)
    // Another person of the same РИК, 30 s later: nothing fetched, no run.
    const again = await checkPersonInRik(t.db, 'a', t.opts)
    expect(again).toMatchObject({ ok: true, outcome: 'throttled', status: 'registered', published: true, runId: null })
    expect((again as { message: string }).message).toBe('РИК 23 е четен преди под минута: публикуван.')
    expect(t.web.calls).toEqual([])
    expect(runs()).toBe(runsBefore)

    // A minute after the last read: fetched again.
    t.advance(31_000)
    expect(await checkPersonInRik(t.db, 'b', t.opts)).toMatchObject({ outcome: 'fetched' })
    expect(t.web.calls.length).toBeGreaterThan(0)
  })

  it('two clicks at once fetch the РИК only once', async () => {
    const t = await setup()
    t.advance(20 * 60_000)
    t.web.calls.length = 0
    const [one, two] = await Promise.all([checkPersonInRik(t.db, 'a', t.opts), checkPersonInRik(t.db, 'b', t.opts)])
    expect([one, two].map((r) => (r as { outcome: string }).outcome).sort()).toEqual(['fetched', 'throttled'])
    expect(t.web.calls.filter((url) => url === REG('23'))).toHaveLength(1)
  })

  it('the cron’s own read counts too: right after a cron run nothing is fetched', async () => {
    const t = await setup()
    t.web.calls.length = 0
    t.advance(10_000)
    expect(await checkPersonInRik(t.db, 'b', t.opts)).toMatchObject({ outcome: 'throttled', status: 'stale', published: false })
    expect(t.web.calls).toEqual([])
  })

  it('never fetches a РИК the site asked us to leave alone', async () => {
    const t = await setup()
    t.advance(20 * 60_000)
    t.raw.prepare('UPDATE rik_sources SET blocked_until = ? WHERE mir = ?').run('2026-10-31T12:00:00.000Z', '23')
    t.web.calls.length = 0
    expect(await checkPersonInRik(t.db, 'b', t.opts)).toMatchObject({ outcome: 'blocked', status: 'stale' })
    expect(t.web.calls).toEqual([])
  })

  it('a РИК that fails to read keeps its data and says so', async () => {
    const t = await setup()
    t.advance(20 * 60_000)
    t.pages.set(REG('23'), { status: 503, body: '' })
    const result = await checkPersonInRik(t.db, 'b', { ...t.opts, retryDelaysMs: [] })
    expect(result).toMatchObject({ ok: true, outcome: 'error', status: 'stale', published: false })
    expect((result as { message: string }).message).toMatch(/^РИК 23 не се прочете \(HTTP 503/)
    expect(t.tasks('23').filter((task) => task.active && task.type === 'call_rik')).toHaveLength(1)
  })

  it('someone without a number is refused', async () => {
    const t = await setup()
    expect(await checkPersonInRik(t.db, 'nobody', t.opts)).toEqual({ ok: false, message: 'Човекът няма пълномощно с номер и МИР.' })
  })
})

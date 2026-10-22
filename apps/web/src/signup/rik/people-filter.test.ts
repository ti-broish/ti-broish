import { describe, expect, it } from 'vitest'
import { RIK_TABLES } from './sql'
import { RIK_LIVE_STATUS_SQL, RIK_TASK_VISIBLE_SQL, rikPeopleWhere } from './people-filter'

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): { run(...values: unknown[]): unknown; all(...values: unknown[]): unknown[] }
}
const sqliteModule = 'node:sqlite'
const sqlite = (await import(/* @vite-ignore */ sqliteModule).catch(() => null)) as { DatabaseSync: new (path: string) => SqliteDatabase } | null

/**
 * МИР 17 (Пловдив област), 21.10.2026: one person had volunteer № 501 and an „И аз“ № 506 with the
 * same ЕГН. № 506 was withdrawn; /admin/rik → МИР 17 → „Всички“ still listed him twice (501 and 506).
 */
const MIR17: Array<[string, 'signup' | 'partner', number, string]> = [
  ['910c49', 'signup', 501, 'rik_unavailable'],
  ['29eeb9', 'signup', 502, 'rik_unavailable'],
  ['1688db', 'signup', 503, 'rik_unavailable'],
  ['6f510b', 'signup', 504, 'rik_unavailable'],
  ['33e822', 'signup', 505, 'rik_unavailable'],
  ['pp-0e2', 'partner', 506, 'withdrawn'],
  ['pp-075', 'partner', 507, 'rik_unavailable'],
]

describe.skipIf(!sqlite)('rikPeopleWhere', () => {
  const db = () => {
    const raw = new sqlite!.DatabaseSync(':memory:')
    for (const sql of RIK_TABLES) raw.exec(sql)
    const insert = raw.prepare(`INSERT INTO rik_status (person_id, source, mir, number, status, status_since, checked_at) VALUES (?, ?, '17', ?, ?, '2026-10-21T17:09:46Z', '2026-10-21T17:09:46Z')`)
    for (const [id, source, number, status] of MIR17) insert.run(id, source, number, status)
    insert.run('dup-1', 'signup', 508, 'duplicate')
    return raw
  }
  const numbers = (raw: SqliteDatabase, input: { mir: string; status: string }) => {
    const { where, binds } = rikPeopleWhere(input)
    return (raw.prepare(`SELECT number FROM rik_status s WHERE ${where.join(' AND ')} ORDER BY s.mir, s.number`).all(...binds) as Array<{ number: number }>).map((row) => row.number)
  }

  it('lists МИР 17 without the withdrawn „И аз“ № 506 (or a duplicate) when no status is picked', () => {
    expect(numbers(db(), { mir: '17', status: '' })).toEqual([501, 502, 503, 504, 505, 507])
  })

  it('still shows the withdrawn row when „Отписан“ is picked', () => {
    expect(numbers(db(), { mir: '17', status: 'withdrawn' })).toEqual([506])
    expect(numbers(db(), { mir: '17', status: 'duplicate' })).toEqual([508])
  })

  it('problems stay problems, never the withdrawn row', () => {
    expect(numbers(db(), { mir: '17', status: 'problems' })).toEqual([501, 502, 503, 504, 505, 507])
  })
})

/**
 * 22.10.2026: a volunteer отписан between two hourly runs still read „Чака РИК“ on /admin/rik and
 * stayed in „Всички“ and in „N с пълномощно“ until the next run. The live status applies it at once.
 */
describe.skipIf(!sqlite)('withdrawals show at once, before the next sync', () => {
  const db = () => {
    const raw = new sqlite!.DatabaseSync(':memory:')
    for (const sql of RIK_TABLES) raw.exec(sql)
    raw.exec('CREATE TABLE signups (id TEXT PRIMARY KEY, withdrawn INTEGER NOT NULL DEFAULT 0, payload TEXT, designation_issued_at TEXT)')
    raw.exec('CREATE TABLE partner_people (id TEXT PRIMARY KEY, withdrawn_at TEXT, first_name TEXT, middle_name TEXT, last_name TEXT, designation_issued_at TEXT)')
    const status = raw.prepare(`INSERT INTO rik_status (person_id, source, mir, number, status, entry_id, status_since, checked_at) VALUES (?, ?, '26', ?, ?, ?, 't', 't')`)
    const rows: Array<[string, 'signup' | 'partner', number, string, string | null, boolean]> = [
      ['a', 'signup', 501, 'pending', null, true], // отписан after the last run
      ['b', 'signup', 502, 'registered', 'e1', true], // отписан, already published
      ['c', 'signup', 503, 'pending', null, false],
      ['d', 'signup', 504, 'stale', null, true], // had a „call the РИК“ task
      ['pp-1', 'partner', 505, 'pending', null, true], // оттеглено „И аз“
      ['pp-2', 'partner', 506, 'pending', null, false],
    ]
    for (const [id, source, number, st, entry, withdrawn] of rows) {
      status.run(id, source, number, st, entry)
      if (source === 'signup') raw.prepare('INSERT INTO signups (id, withdrawn) VALUES (?, ?)').run(id, withdrawn ? 1 : 0)
      else raw.prepare('INSERT INTO partner_people (id, withdrawn_at) VALUES (?, ?)').run(id, withdrawn ? '2026-10-22T11:00:00Z' : null)
    }
    const task = raw.prepare(`INSERT INTO rik_tasks (id, person_id, mir, type, reason, created_at, updated_at) VALUES (?, ?, '26', ?, ?, 't', 't')`)
    task.run('d:call_rik:not_published', 'd', 'call_rik', 'not_published')
    task.run('c:call_rik:not_published', 'c', 'call_rik', 'not_published')
    task.run('b:remove_person:withdrawn', 'b', 'remove_person', 'withdrawn')
    task.run('rik:26:check_rik', null, 'check_rik', 'error')
    return raw
  }
  const live = (raw: SqliteDatabase, input: { mir: string; status: string }) => {
    const { where, binds } = rikPeopleWhere(input)
    return (raw.prepare(`SELECT number FROM (${RIK_LIVE_STATUS_SQL}) s WHERE ${where.join(' AND ')} ORDER BY s.mir, s.number`).all(...binds) as Array<{ number: number }>).map((row) => row.number)
  }

  it('„Всички“ drops the withdrawn right away, both volunteers and „И аз“', () => {
    expect(live(db(), { mir: '26', status: '' })).toEqual([502, 503, 506])
  })

  it('an already published withdrawn person reads „За заличаване в РИК“, the rest „Отписан“', () => {
    const raw = db()
    expect(live(raw, { mir: '26', status: 'withdrawn_registered' })).toEqual([502])
    expect(live(raw, { mir: '26', status: 'withdrawn' })).toEqual([501, 504, 505])
    expect(live(raw, { mir: '26', status: 'problems' })).toEqual([502])
  })

  it('open tasks: a withdrawn person keeps only „Махни човека“; others and РИК tasks stay', () => {
    const ids = (db().prepare(`SELECT id FROM rik_tasks t WHERE t.active = 1 AND ${RIK_TASK_VISIBLE_SQL} ORDER BY id`).all() as Array<{ id: string }>).map((row) => row.id)
    expect(ids).toEqual(['b:remove_person:withdrawn', 'c:call_rik:not_published', 'rik:26:check_rik'])
  })
})

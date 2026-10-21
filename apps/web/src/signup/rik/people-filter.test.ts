import { describe, expect, it } from 'vitest'
import { RIK_TABLES } from './sql'
import { rikPeopleWhere } from './people-filter'

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

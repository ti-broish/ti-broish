import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SIGNING_WAVE_SCHEMA } from './signed-waves-sql'

// sql/2026-10-29-signing-waves-backfill.sql closes waves of past PDF dates only. The first version
// also closed 29.10 (the day it ran), which had not gone to the РИК. Today's wave stays open
// (designation_wave_id NULL, no signing_waves row) until „Изпратена на РИК“, also on a re-run.
const BACKFILL = readFileSync(new URL('../../sql/2026-10-29-signing-waves-backfill.sql', import.meta.url), 'utf8')
const statements = BACKFILL.split('\n').filter((line) => line.trim() && !line.startsWith('--'))

type Db = { exec(sql: string): void; prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] } }

async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

const sqlite = await openDb()

/** dd.mm.yyyy in Europe/Sofia, as designation_issued_at is written. */
function sofiaDate(at: Date) {
  return new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', year: 'numeric' }).format(at).replace(/\s*г\.?$/, '')
}

describe('signing waves backfill SQL', () => {
  it('only closes dates before the day it was written (29.10.2026)', () => {
    const dates = [...BACKFILL.matchAll(/INSERT OR IGNORE INTO signing_waves[^;]*?'(\d{4}-\d{2}-\d{2})'/g)].map((match) => match[1]!)
    expect(dates.length).toBeGreaterThan(0)
    for (const date of dates) expect(date < '2026-10-29').toBe(true)
    expect(BACKFILL).not.toMatch(/INSERT[^;]*strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)/)
  })

  it.skipIf(!sqlite)('closes a past date and leaves 29.10 and today open, also when run twice', () => {
    const db = sqlite!
    db.exec('CREATE TABLE signups (id TEXT PRIMARY KEY, designation_number INTEGER, designation_issued_at TEXT)')
    db.exec('CREATE TABLE partner_people (id TEXT PRIMARY KEY, designation_number INTEGER, designation_issued_at TEXT)')
    for (const sql of SIGNING_WAVE_SCHEMA) db.exec(sql)
    const today = sofiaDate(new Date())
    const addSignup = db.prepare('INSERT INTO signups (id, designation_number, designation_issued_at) VALUES (?, ?, ?)')
    addSignup.run('past', 501, '19.10.2026')
    addSignup.run('day-it-ran', 502, '29.10.2026')
    addSignup.run('today', 503, today)
    addSignup.run('unnumbered', null, '19.10.2026')
    const addPartner = db.prepare('INSERT INTO partner_people (id, designation_number, designation_issued_at) VALUES (?, ?, ?)')
    addPartner.run('pp-past', 504, '2026-10-21')
    addPartner.run('pp-today', 505, today)
    for (let run = 0; run < 2; run += 1) for (const sql of statements) db.exec(sql)

    const waves = db.prepare('SELECT id, issue_date, closed_by FROM signing_waves ORDER BY issue_date').all() as Array<{ id: string; issue_date: string }>
    expect(waves.map((wave) => wave.id)).toEqual(['backfill-2026-10-19', 'backfill-2026-10-21', 'backfill-2026-10-22', 'backfill-2026-10-23', 'backfill-2026-10-24', 'backfill-2026-10-27'])
    const waveOf = (table: string) => Object.fromEntries((db.prepare(`SELECT id, designation_wave_id AS w FROM ${table}`).all() as Array<{ id: string; w: string | null }>).map((row) => [row.id, row.w]))
    expect(waveOf('signups')).toEqual({ past: 'backfill-2026-10-19', 'day-it-ran': null, today: null, unnumbered: null })
    expect(waveOf('partner_people')).toEqual({ 'pp-past': 'backfill-2026-10-21', 'pp-today': null })
  })
})

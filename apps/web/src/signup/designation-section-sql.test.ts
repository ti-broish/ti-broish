import { describe, expect, it } from 'vitest'
import { SIGNUP_DESIGNATION_SECTION_SQL, isPlaceholderEmail } from './designation-section-sql'

type Db = { exec(sql: string): void; prepare(sql: string): { all(...args: unknown[]): unknown[] } }

async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

const sqlite = await openDb()

describe.skipIf(!sqlite)('SIGNUP_DESIGNATION_SECTION_SQL', () => {
  it('uses the published section, else the МИР of a number, else nothing', () => {
    const db = sqlite!
    db.exec('CREATE TABLE signups (id TEXT, published_section TEXT, designation_mir TEXT, designation_number INTEGER)')
    db.exec(`INSERT INTO signups VALUES
      ('published', '183100012', '18', 503),
      ('mir-only', NULL, '18', 521),
      ('mir-only-empty', '', '04', 509),
      ('no-number', '', '18', NULL),
      ('nothing', NULL, NULL, NULL)`)
    const rows = db.prepare(`SELECT id, ${SIGNUP_DESIGNATION_SECTION_SQL} AS section FROM signups ORDER BY id`).all() as { id: string; section: string }[]
    expect(Object.fromEntries(rows.map((row) => [row.id, row.section]))).toEqual({
      'mir-only': '18',
      'mir-only-empty': '04',
      'no-number': '',
      nothing: '',
      published: '183100012',
    })
  })
})

describe('isPlaceholderEmail', () => {
  it('flags only the …@tibroish.invalid stand-in', () => {
    expect(isPlaceholderEmail('bez-imeil-abc12345@tibroish.invalid')).toBe(true)
    expect(isPlaceholderEmail(' BEZ-IMEIL-X@TIBROISH.INVALID ')).toBe(true)
    expect(isPlaceholderEmail('someone@tibroish.bg')).toBe(false)
    expect(isPlaceholderEmail('')).toBe(false)
    expect(isPlaceholderEmail(null)).toBe(false)
  })
})

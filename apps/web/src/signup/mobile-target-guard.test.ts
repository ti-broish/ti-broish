import { describe, expect, it } from 'vitest'
import { MOBILE_TARGET_ORG, mobileTargetCodes, mobileTargetOrgOf } from './reserved-sections-db'
import { MOBILE_DRAFTS_TABLE } from './mobile-teams-sql'

interface Db {
  exec(sql: string): void
  prepare(sql: string): { run(...v: unknown[]): unknown; all(...v: unknown[]): unknown[]; get(...v: unknown[]): unknown }
}
const mod = (await import(/* @vite-ignore */ 'node:sqlite').catch(() => null)) as { DatabaseSync: new (path: string) => Db } | null

/** D1-shaped wrapper over node:sqlite: prepare → bind → first/all. */
function d1(raw: Db) {
  const make = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => make(sql, next),
    first: async () => (raw.prepare(sql).get(...values) as unknown) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...values) }),
  })
  return { prepare: (sql: string) => make(sql) } as never
}

/**
 * 22.10.2026: two coordinator-list volunteers (МИР 04, 25) were given sections by hand that were
 * targets of automatic mobile areas; nothing on that path looked at mobile_drafts.
 */
describe.skipIf(!mod)('mobile-team targets hold their sections', () => {
  it('the country allocator blocks every current mobile target (254611071 in МИР 25 was drafted to a volunteer)', async () => {
    const raw = new mod!.DatabaseSync(':memory:')
    raw.exec(MOBILE_DRAFTS_TABLE)
    raw.exec('CREATE TABLE taken_sections (section_code TEXT PRIMARY KEY, organisation TEXT)')
    raw.exec('CREATE TABLE signups (id TEXT PRIMARY KEY, withdrawn INTEGER, draft_section TEXT, published_section TEXT, draft_locked INTEGER)')
    raw
      .prepare(`INSERT INTO mobile_drafts (signup_id, team_key, mir_code, municipality_code, area_key, area_label, targets, source, created_by, created_at, updated_at) VALUES ('m', 'm', '25', '', '', '', ?, 'auto', 't', 't', 't')`)
      .run(JSON.stringify([{ code: '254611071' }]))
    const { blockedSectionsForTest } = await import('./distribute-plan')
    expect(await blockedSectionsForTest(d1(raw), false)).toContain('254611071')
    expect(await blockedSectionsForTest(d1(raw), true)).toContain('254611071')
  })

  const db = () => {
    const raw = new mod!.DatabaseSync(':memory:')
    raw.exec(MOBILE_DRAFTS_TABLE)
    const insert = raw.prepare(
      `INSERT INTO mobile_drafts (signup_id, team_key, mir_code, municipality_code, area_key, area_label, targets, source, created_by, created_at, updated_at)
       VALUES (?, ?, ?, '', '', '', ?, ?, 'test', 't', 't')`,
    )
    insert.run('mob-auto', 'mob-auto', '04', JSON.stringify([{ code: '040400005' }, { code: '040400007' }]), 'auto')
    insert.run('mob-hand', 'mob-hand', '25', JSON.stringify([{ code: '254611006' }]), 'manual')
    return d1(raw)
  }

  it('a section volunteer is refused a target of someone else’s area, as a reservation', async () => {
    const one = db()
    expect(await mobileTargetOrgOf(one, '040400005', 'volunteer-1')).toBe(MOBILE_TARGET_ORG)
    expect(await mobileTargetOrgOf(one, '04 04 00 005', 'volunteer-1')).toBe(MOBILE_TARGET_ORG)
    expect(await mobileTargetOrgOf(one, '040400009', 'volunteer-1')).toBeNull()
  })

  it('the mobile volunteer’s own area does not block their own section', async () => {
    expect(await mobileTargetOrgOf(db(), '040400005', 'mob-auto')).toBeNull()
  })

  it('every current target is listed for the allocator; manualOnly narrows to hand-saved areas', async () => {
    const one = db()
    expect([...(await mobileTargetCodes(one, false))].sort()).toEqual(['040400005', '040400007', '254611006'])
    expect([...(await mobileTargetCodes(one, true))]).toEqual(['254611006'])
  })
})

import { describe, expect, it } from 'vitest'
import { freedSectionFromAuditAfter, restoreAuditBefore } from './admin-unregister'
import { PARTNER_PEOPLE_TABLE, PARTNER_SECTION_COLUMNS, PARTNER_WITHDRAWAL_COLUMNS } from './partner-people-sql'
import {
  PARTNER_LAST_FREED_SQL,
  PARTNER_RESTORE_SQL,
  PARTNER_UNREGISTER_SQL,
  parsePartnerUnregister,
  partnerUnregisterAuditAfter,
  partnerUnregisterAuditBefore,
  partnerWithdrawnReasonText,
} from './partner-unregister'

type Stmt = { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown; run(...args: unknown[]): { changes: number | bigint } }
type Db = { exec(sql: string): void; prepare(sql: string): Stmt }

async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

const sqlite = await openDb()

describe('„Отпиши“ for „И аз“: texts', () => {
  it('needs a known reason; the note is optional and clipped', () => {
    expect(parsePartnerUnregister({ reason: 'other', note: '  само видеонаблюдение ' })).toEqual({ reason: 'other', note: 'само видеонаблюдение' })
    expect(parsePartnerUnregister({ reason: 'whatever' }).reason).toBeNull()
    expect(parsePartnerUnregister({ reason: 'call_quit', note: 'x'.repeat(900) }).note.length).toBe(400)
  })

  it('keeps one reason text (label · note) within the column limit', () => {
    expect(partnerWithdrawnReasonText('other', 'само видеонаблюдение')).toBe('Друго · само видеонаблюдение')
    expect(partnerWithdrawnReasonText('sik_member', '')).toBe('Ще бъде член на СИК')
    expect(partnerWithdrawnReasonText('other', 'x'.repeat(400)).length).toBeLessThanOrEqual(300)
  })

  it('audit lines say what was freed and that the number stays; the freed section is readable for „Върни“', () => {
    const person = { draft: '040400134', published: '040400134', mir: '04', number: 503 }
    expect(partnerUnregisterAuditBefore(person)).toContain('№ 04/503')
    const after = partnerUnregisterAuditAfter('other', 'само видеонаблюдение', person)
    expect(after).toContain('освободена публикувана 040400134')
    expect(after).toContain('номерът остава')
    expect(freedSectionFromAuditAfter(after)).toBe('040400134')
    expect(partnerUnregisterAuditAfter('call_quit', '', { draft: '', published: '', number: null })).not.toContain('номерът')
    expect(restoreAuditBefore('Друго · само видеонаблюдение', '', '040400134')).toBe('Отписан · Друго · само видеонаблюдение · предишна секция 040400134')
  })
})

describe.skipIf(!sqlite)('„Отпиши“ / „Върни“ for „И аз“ (SQLite, as D1)', () => {
  const db = sqlite!
  db.exec(PARTNER_PEOPLE_TABLE)
  for (const sql of [...PARTNER_SECTION_COLUMNS, ...PARTNER_WITHDRAWAL_COLUMNS]) db.exec(sql)
  db.exec('CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT NOT NULL, actor TEXT NOT NULL, field TEXT NOT NULL, before_text TEXT NOT NULL, after_text TEXT NOT NULL, created_at TEXT NOT NULL)')
  db.prepare(`INSERT INTO partner_people (id, partner, egn, email, phone, first_name, middle_name, last_name, region_code, designation_mir, designation_number,
    imported_at, updated_at, section_draft, section_draft_locked, section_published, section_published_at) VALUES ('pp-a', 'iaz.bg', '', 'a@example.com', '', 'А', '', 'Б', '04', '04', 503,
    '2026-10-19T20:00:00Z', '2026-10-20T10:00:00Z', '040400134', 1, '040400134', '2026-10-21T10:00:00Z')`).run()
  const row = () => db.prepare('SELECT * FROM partner_people WHERE id = ?').get('pp-a') as Record<string, unknown>

  it('frees the section, keeps МИР and number, and only changes an active row', () => {
    expect(Number(db.prepare(PARTNER_UNREGISTER_SQL).run('2026-10-29T12:00:00Z', 'admin@example.com', 'Друго · само видеонаблюдение', 'pp-a').changes)).toBe(1)
    expect(row()).toMatchObject({
      withdrawn_at: '2026-10-29T12:00:00Z',
      withdrawn_by: 'admin@example.com',
      withdrawn_reason: 'Друго · само видеонаблюдение',
      section_draft: null,
      section_draft_locked: 0,
      section_published: null,
      section_published_at: null,
      designation_mir: '04',
      designation_number: 503,
    })
    expect(Number(db.prepare(PARTNER_UNREGISTER_SQL).run('2026-10-29T13:00:00Z', 'x', 'y', 'pp-a').changes)).toBe(0)
    expect(row().withdrawn_at).toBe('2026-10-29T12:00:00Z')
  })

  it('reads the freed section from the latest „withdrawn“ audit line', () => {
    const insert = db.prepare('INSERT INTO signup_audit VALUES (?, ?, ?, ?, ?, ?, ?)')
    insert.run('a1', 'pp-a', 'x', 'withdrawn', 'before', 'Отписан · Друго · освободена публикувана 999999999', '2026-10-28T10:00:00Z')
    insert.run('a2', 'pp-a', 'x', 'withdrawn', 'before', 'Отписан · Друго · освободена публикувана 040400134 · номерът остава', '2026-10-29T12:00:00Z')
    insert.run('a3', 'pp-a', 'x', 'Секция', '1', '2', '2026-10-29T12:30:00Z')
    const last = db.prepare(PARTNER_LAST_FREED_SQL).get('pp-a') as { after_text: string }
    expect(freedSectionFromAuditAfter(last.after_text)).toBe('040400134')
  })

  it('„Върни“ makes the row active again; the section does not come back', () => {
    expect(Number(db.prepare(PARTNER_RESTORE_SQL).run('2026-10-29T14:00:00Z', 'pp-a').changes)).toBe(1)
    expect(row()).toMatchObject({ withdrawn_at: null, withdrawn_by: null, withdrawn_reason: null, section_published: null, designation_number: 503, updated_at: '2026-10-29T14:00:00Z' })
    expect(Number(db.prepare(PARTNER_RESTORE_SQL).run('2026-10-29T15:00:00Z', 'pp-a').changes)).toBe(0)
  })
})

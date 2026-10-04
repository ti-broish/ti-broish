import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditLines, describeAudit, staffAuditChanges, type StaffSnapshot } from './admin-audit'

const same: StaffSnapshot = {
  role: 'section',
  roundsFirst: true,
  roundsRunoff: true,
  staffNote: 'Ще дойде.',
}

describe('staff audit', () => {
  it('records role, days, and the team note, and ignores an unchanged callback', () => {
    expect(
      staffAuditChanges(same, {
        role: 'mobile',
        roundsFirst: true,
        roundsRunoff: false,
        staffNote: '  ',
      }),
    ).toEqual([
      { field: 'role', before: 'Секция', after: 'Мобилен екип' },
      { field: 'days', before: '25 октомври и 1 ноември', after: '25 октомври' },
      { field: 'staff_note', before: 'Ще дойде.', after: 'Празна бележка' },
    ])
    expect(staffAuditChanges(same, { ...same, staffNote: '  Ще дойде.  ' })).toEqual([])
    expect(describeAudit('role', 'Секция', 'Мобилен екип')).toBe('Роля: Секция → Мобилен екип')
    expect(describeAudit('egn', '0041010002', '')).toBe('')
  })

  it('clips a long note and drops unknown fields when reading', () => {
    const long = 'а'.repeat(400)
    const [note] = staffAuditChanges(same, { ...same, staffNote: long })
    expect(note?.before).toBe('Ще дойде.')
    expect(note?.after.endsWith('…')).toBe(true)
    expect(note?.after.length).toBe(280)
    expect(
      auditLines([
        { id: '1', actor: 'ada@example.com', field: 'role', before_text: 'Секция', after_text: 'Мобилен екип', created_at: '2026-10-03T12:00:00.000Z' },
        { id: '2', actor: 'ada@example.com', field: 'egn', before_text: '0041010002', after_text: '', created_at: '2026-10-03T12:00:00.000Z' },
      ]),
    ).toEqual([
      { id: '1', actor: 'ada@example.com', field: 'role', before: 'Секция', after: 'Мобилен екип', at: '2026-10-03T12:00:00.000Z' },
    ])
  })

  it('is written from the staff save, not from a volunteer save', () => {
    const admin = readFileSync(new URL('./admin.ts', import.meta.url), 'utf8')
    const start = admin.indexOf('export const adminUpdatePerson')
    const body = admin.slice(start)
    expect(body).toContain('staffAuditChanges')
    const insertAt = body.indexOf('INSERT INTO signup_audit')
    expect(insertAt).toBeGreaterThan(-1)
    const insertSql = body.slice(insertAt, body.indexOf('`', insertAt))
    expect(insertSql).not.toMatch(/egn|payload|staff_called/)
    const volunteer = readFileSync(new URL('./db.ts', import.meta.url), 'utf8')
    expect(volunteer).not.toContain('signup_audit')
  })
})

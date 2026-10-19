import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditLines, describeAudit } from './admin-audit'
import { OPEN_CALL_SQL } from './admin-csv'
import {
  CALL_REOPEN_AUDIT_SQL,
  CALLED_LABEL,
  callReopenAudit,
  callRequestFromPayload,
  callRequestRenewed,
  calledText,
  renewedRequestAt,
  reopenCalledSql,
} from './call-reopen'

const calledAt = '2026-10-10T09:00:00.000Z'
const asked = { callRequestedAt: '2026-10-02T08:00:00.000Z', callMessage: 'За секцията' }

describe('called label', () => {
  it('reads „Обадили сме се“', () => {
    expect(CALLED_LABEL).toBe('Обадили сме се')
    expect(calledText(calledAt, "ada@example.com")).toMatch(/^Обадили сме се на .+ от ada@example\.com$/)
    expect(calledText('not a date', '')).toBe('Обадили сме се на not a date')
  })
})

describe('a new call request after the team called', () => {
  it('reopens when the person asks again after dropping the request', () => {
    expect(callRequestRenewed({ callRequestedAt: null, callMessage: '' }, { callRequestedAt: '2026-10-12T10:00:00.000Z', callMessage: 'Пак' }, calledAt)).toBe(true)
    expect(callRequestRenewed(null, asked, calledAt)).toBe(true)
  })

  it('reopens when the reason changes', () => {
    expect(callRequestRenewed(asked, { ...asked, callMessage: 'Друг въпрос' }, calledAt)).toBe(true)
  })

  it('reopens when the request carries a timestamp after the call', () => {
    expect(callRequestRenewed(asked, { ...asked, callRequestedAt: '2026-10-12T10:00:00.000Z' }, calledAt)).toBe(true)
  })

  it('leaves the mark alone for an unchanged request or other edits', () => {
    expect(callRequestRenewed(asked, { ...asked }, calledAt)).toBe(false)
    expect(callRequestRenewed(asked, { ...asked, callMessage: '  За секцията ' }, calledAt)).toBe(false)
    expect(callRequestRenewed(asked, { ...asked, callRequestedAt: '2026-10-01T08:00:00.000Z' }, calledAt)).toBe(false)
  })

  it('does nothing when the team has not called or there is no open request', () => {
    expect(callRequestRenewed(null, asked, '')).toBe(false)
    expect(callRequestRenewed(asked, { callRequestedAt: null, callMessage: '' }, calledAt)).toBe(false)
    expect(callRequestRenewed(null, { callRequestedAt: '2026-10-12T10:00:00.000Z', callMessage: '   ' }, calledAt)).toBe(false)
  })

  it('stamps a renewed request after the old call', () => {
    expect(renewedRequestAt(asked.callRequestedAt, calledAt, '2026-10-19T12:00:00.000Z')).toBe('2026-10-19T12:00:00.000Z')
    expect(renewedRequestAt(null, calledAt, '2026-10-19T12:00:00.000Z')).toBe('2026-10-19T12:00:00.000Z')
    expect(renewedRequestAt('2026-10-12T10:00:00.000Z', calledAt, '2026-10-19T12:00:00.000Z')).toBe('2026-10-12T10:00:00.000Z')
  })

  it('clears only the staff call columns, guarded by the mark it read, so the queue picks the person up', () => {
    const sql = reopenCalledSql()
    expect(sql).toContain('staff_called_at = NULL')
    expect(sql).toContain('staff_called_by = NULL')
    expect(sql).toContain('WHERE id = ? AND staff_called_at = ?')
    expect(sql).not.toMatch(/payload|staff_note/)
    expect(OPEN_CALL_SQL).toContain('callRequestedAt')
  })

  it('reads the stored request from the payload', () => {
    expect(callRequestFromPayload(JSON.stringify(asked))).toEqual(asked)
    expect(callRequestFromPayload(JSON.stringify({ callRequestedAt: '', callMessage: 7 }))).toEqual({ callRequestedAt: null, callMessage: '' })
    expect(callRequestFromPayload('{broken')).toBeNull()
    expect(callRequestFromPayload(null)).toBeNull()
  })
})

describe('call reopen history', () => {
  it('keeps the old call in the audit trail', () => {
    const audit = callReopenAudit(calledAt, 'ada@example.com', 'Пак за секцията')
    expect(audit.field).toBe('call_reopened')
    expect(audit.before).toContain('Обадили сме се на')
    expect(audit.before).toContain('ada@example.com')
    expect(audit.after).toBe('Нова заявка за обаждане: Пак за секцията')
    expect(callReopenAudit(calledAt, '', 'а'.repeat(400)).after.length).toBeLessThan(320)
  })

  it('shows the reopen row on the person page', () => {
    const lines = auditLines([
      { id: '1', actor: 'ivan@example.com', field: 'call_reopened', before_text: 'Обадили сме се на 10.10', after_text: 'Нова заявка за обаждане: Пак', created_at: calledAt },
    ])
    expect(lines).toHaveLength(1)
    expect(describeAudit(lines[0].field, lines[0].before, lines[0].after)).toBe('Обаждане: Обадили сме се на 10.10 → Нова заявка за обаждане: Пак')
  })

  it('wires the volunteer save and the cant-reach report to reopen and audit', () => {
    const source = readFileSync(new URL('./db.ts', import.meta.url), 'utf8')
    const save = source.slice(source.indexOf('export const saveSignup'), source.indexOf('export const reportCantReach'))
    expect(save).toContain('callRequestRenewed')
    expect(save).toContain('reopenCalledSql()')
    expect(save).toContain('callReopenAudit')
    expect(save).toContain('CALL_REOPEN_AUDIT_SQL')
    expect(save).not.toContain('staffAuditChanges')
    // The upsert itself still never touches the team's columns.
    expect(save).not.toMatch(/staff_called_at\s*=\s*excluded/)
    const cantReach = source.slice(source.indexOf('export const reportCantReach'))
    expect(cantReach).toContain('callReopenAudit')
    expect(CALL_REOPEN_AUDIT_SQL).toContain('INSERT INTO signup_audit')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { callbackIds, callbackMessage, callbackSetSql, chunkIds, toggleSelected } from './admin-bulk'

describe('bulk callback', () => {
  it('keeps only safe ids and stops at 200', () => {
    const noisy = callbackIds([' ok-1 ', 'ok-1', 'bad id', "1'; DROP TABLE signups; --", '', 'e2e-call'])
    expect(noisy.ids).toEqual(['ok-1', 'e2e-call'])
    expect(noisy.truncated).toBe(false)
    const many = callbackIds(Array.from({ length: 230 }, (_, index) => `id-${index}`))
    expect(many.ids).toHaveLength(200)
    expect(many.ids[0]).toBe('id-0')
    expect(many.truncated).toBe(true)
  })

  it('updates only the callback columns, with bound ids', () => {
    const sql = callbackSetSql(true, 2)
    expect(sql).toContain('staff_called_at = ?')
    expect(sql).toContain('staff_called_by = ?')
    expect(sql).toContain('id IN (?, ?)')
    expect(sql).toContain("COALESCE(staff_called_at, '') = ''")
    expect(sql).not.toMatch(/staff_note|payload|egn|email/i)
    expect(callbackSetSql(false, 1)).toContain("COALESCE(staff_called_at, '') != ''")
    expect(chunkIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })

  it('says how many people changed, and when the filter was capped', () => {
    expect(callbackMessage(true, 1, false)).toBe('Отбелязахме обаждане за 1 човек.')
    expect(callbackMessage(false, 3, false)).toBe('Махнахме обаждането за 3 души.')
    expect(callbackMessage(true, 500, true)).toBe('Отбелязахме обаждане за 500 души. В изгледа има още.')
    expect(callbackMessage(true, 0, false)).toBe('Няма хора без отбелязано обаждане в този избор.')
  })

  it('toggles a row without dropping the rest of the selection', () => {
    expect([...toggleSelected(new Set(['a']), 'b', true)].sort()).toEqual(['a', 'b'])
    expect([...toggleSelected(new Set(['a', 'b']), 'a', false)]).toEqual(['b'])
  })

  it('does not send mail from the bulk callback', () => {
    const source = readFileSync(new URL('./admin.ts', import.meta.url), 'utf8')
    const start = source.indexOf('export const adminBulkCallback')
    const end = source.indexOf('export const adminExport')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = source.slice(start, end)
    expect(body).toContain("gate('edit')")
    expect(body).toContain('callbackIds')
    expect(body).toContain('callbackSetSql')
    expect(body).not.toContain('deliverMail')
    expect(body).not.toContain('staff_note')
    expect(body).not.toMatch(/\begn\b/)
  })
})

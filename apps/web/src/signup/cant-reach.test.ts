import { describe, expect, it } from 'vitest'
import {
  CALL_MESSAGE_MAX,
  applyCantReachReport,
  buildCantReachMessage,
  cantReachAlreadyPresent,
  cantReachBadgeLabel,
  cantReachStem,
  fitCallMessage,
  normalizeCantReachSection,
  reopenCallQueueSql,
} from './cant-reach'
import { OPEN_CALL_SQL } from './admin-csv'
import { emptyProfile } from './model'
import { signupColumns } from './record'

describe('cant-reach message', () => {
  it('builds a fresh message with and without a note', () => {
    expect(buildCantReachMessage({ existingMessage: '', section: '234600101' })).toBe(
      'Не мога да стигна до секция 234600101.',
    )
    expect(buildCantReachMessage({ existingMessage: '', section: '234600101', note: 'Няма транспорт' })).toBe(
      'Не мога да стигна до секция 234600101. Няма транспорт',
    )
  })

  it('appends to an open call message with a consistent separator', () => {
    expect(
      buildCantReachMessage({
        existingMessage: 'За секцията',
        section: '234600101',
        note: 'Колата се счупи',
      }),
    ).toBe('За секцията · Не мога да стигна до секция 234600101: Колата се счупи')
    expect(buildCantReachMessage({ existingMessage: 'За секцията', section: '234600101' })).toBe(
      'За секцията · Не мога да стигна до секция 234600101.',
    )
  })

  it('does not append the same stem twice', () => {
    const once = buildCantReachMessage({ existingMessage: 'За секцията', section: '234600101', note: 'Първо' })
    expect(cantReachAlreadyPresent(once, '234600101')).toBe(true)
    expect(buildCantReachMessage({ existingMessage: once, section: '234600101', note: 'Второ' })).toBe(once)
  })

  it('keeps the new phrase when trimming to the limit', () => {
    const existing = 'а'.repeat(CALL_MESSAGE_MAX)
    const next = fitCallMessage(existing, 'Не мога да стигна до секция 234600101.')
    expect(next.length).toBeLessThanOrEqual(CALL_MESSAGE_MAX)
    expect(next.endsWith('Не мога да стигна до секция 234600101.')).toBe(true)
    expect(next).toContain(' · ')
  })

  it('keeps an existing timestamp and sets the structured flag', () => {
    const result = applyCantReachReport({
      callMessage: 'За секцията',
      callRequestedAt: '2026-10-02T08:00:00.000Z',
      section: '234600101',
      note: 'Болен съм',
      now: '2026-10-17T12:00:00.000Z',
    })
    expect(result.callRequestedAt).toBe('2026-10-02T08:00:00.000Z')
    expect(result.cantReachSection).toEqual({ section: '234600101', at: '2026-10-17T12:00:00.000Z' })
    expect(result.callMessage).toContain(cantReachStem('234600101'))
  })

  it('opens a new request when none exists', () => {
    const result = applyCantReachReport({
      callMessage: '',
      callRequestedAt: null,
      section: '234600101',
      now: '2026-10-17T12:00:00.000Z',
    })
    expect(result.callRequestedAt).toBe('2026-10-17T12:00:00.000Z')
    expect(result.callMessage).toBe('Не мога да стигна до секция 234600101.')
  })
})

describe('cant-reach flag normalization', () => {
  it('keeps a flag that matches the published section', () => {
    expect(
      normalizeCantReachSection({
        assignedSection: '234600101',
        cantReachSection: { section: '234600101', at: '2026-10-17T12:00:00.000Z' },
      }).cantReachSection,
    ).toEqual({ section: '234600101', at: '2026-10-17T12:00:00.000Z' })
  })

  it('clears the flag when the published section changed or is gone', () => {
    expect(
      normalizeCantReachSection({
        assignedSection: '234600199',
        cantReachSection: { section: '234600101', at: '2026-10-17T12:00:00.000Z' },
      }).cantReachSection,
    ).toBeNull()
    expect(
      normalizeCantReachSection({
        assignedSection: null,
        cantReachSection: { section: '234600101', at: '2026-10-17T12:00:00.000Z' },
      }).cantReachSection,
    ).toBeNull()
    expect(normalizeCantReachSection({ assignedSection: '234600101', cantReachSection: null }).cantReachSection).toBeNull()
  })

  it('persists in signup payload and clears when the published section no longer matches', () => {
    const profile = {
      ...emptyProfile(),
      email: 'ivan@example.com',
      callRequestedAt: '2026-10-17T12:00:00.000Z',
      callMessage: 'Не мога да стигна до секция 234600101.',
      cantReachSection: { section: '234600101', at: '2026-10-17T12:00:00.000Z' },
      assignedSection: '234600101',
    }
    const payload = JSON.parse(signupColumns(profile).payload) as {
      cantReachSection: { section: string; at: string }
      callMessage: string
      assignedSection?: unknown
    }
    expect(payload.assignedSection).toBeUndefined()
    expect(payload.cantReachSection).toEqual({ section: '234600101', at: '2026-10-17T12:00:00.000Z' })
    // profileFrom applies the same normalize after reading published_section into assignedSection.
    expect(
      normalizeCantReachSection({
        ...payload,
        assignedSection: '234600101',
      }).cantReachSection,
    ).toEqual({ section: '234600101', at: '2026-10-17T12:00:00.000Z' })
    expect(
      normalizeCantReachSection({
        ...payload,
        assignedSection: '234600199',
      }).cantReachSection,
    ).toBeNull()
    expect(payload.callMessage).toContain('Не мога да стигна')
  })
})

describe('cant-reach admin queue reopen', () => {
  it('clears staff_called columns so OPEN_CALL_SQL + empty called puts them back in queue', () => {
    const sql = reopenCallQueueSql()
    expect(sql).toContain('staff_called_at = NULL')
    expect(sql).toContain('staff_called_by = NULL')
    expect(sql).toContain('payload = ?')
    expect(OPEN_CALL_SQL).toContain('callRequestedAt')
    expect(OPEN_CALL_SQL).toContain('callMessage')
  })

  it('labels the badge with the section', () => {
    expect(cantReachBadgeLabel('234600101')).toBe('Не може да стигне до секцията (234600101)')
    expect(cantReachBadgeLabel('')).toBe('Не може да стигне до секцията')
  })
})

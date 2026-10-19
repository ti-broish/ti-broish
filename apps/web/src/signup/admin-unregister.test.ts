import { describe, expect, it, vi } from 'vitest'
import {
  brevoOutcomeAuditSuffix,
  clipWithdrawNote,
  freedSectionFromAuditAfter,
  parseWithdrawReason,
  restoreAuditAfter,
  restoreAuditBefore,
  restoreSql,
  unregisterMessage,
  unregisterSql,
  withdrawAuditAfter,
  withdrawAuditBefore,
  withdrawReasonLabel,
} from './admin-unregister'
import { distributionWhere, rosterWhere } from './admin-csv'
import { describeAudit, auditLines } from './admin-audit'
import { removeContactsFromList, type BrevoConfig } from './brevo'

vi.mock('cloudflare:workers', () => ({ env: {} }))

describe('withdraw reasons', () => {
  it('parses known reasons and clips the note', () => {
    expect(parseWithdrawReason('call_quit')).toBe('call_quit')
    expect(parseWithdrawReason('sik_member')).toBe('sik_member')
    expect(parseWithdrawReason('other')).toBe('other')
    expect(parseWithdrawReason('nope')).toBeNull()
    expect(clipWithdrawNote('  бележка  ')).toBe('бележка')
    expect(clipWithdrawNote('x'.repeat(500)).length).toBe(400)
    expect(withdrawReasonLabel('call_quit')).toBe('Отказа се (обаждане)')
    expect(withdrawReasonLabel('sik_member')).toBe('Ще бъде член на СИК')
    expect(withdrawReasonLabel('other')).toBe('Друго')
  })
})

describe('withdraw audit copy', () => {
  it('records the freed assignment and reason', () => {
    expect(withdrawAuditBefore('234600199', '234600101')).toBe('Активен · публикувана 234600101 · чернова 234600199')
    expect(withdrawAuditAfter('call_quit', 'Обади се', '234600199', '234600101')).toBe(
      'Отписан · Отказа се (обаждане) · Обади се · освободена публикувана 234600101 · освободена чернова 234600199',
    )
    expect(withdrawAuditAfter('other', '', '', '')).toBe('Отписан · Друго · без секция')
    expect(freedSectionFromAuditAfter('Отписан · Друго · освободена публикувана 234600101')).toBe('234600101')
    expect(restoreAuditBefore('sik_member', 'в СИК', '234600101')).toBe('Отписан · Ще бъде член на СИК · в СИК · предишна секция 234600101')
    expect(restoreAuditAfter()).toContain('не се връща')
    expect(describeAudit('withdrawn', 'Активен', 'Отписан · Друго · без секция')).toBe('Отписване: Отписан · Друго · без секция')
    expect(describeAudit('restored', 'Отписан', 'Възстановен · секцията не се връща автоматично')).toContain('Възстановяване:')
    expect(
      auditLines([
        {
          id: '1',
          actor: 'ada@example.com',
          field: 'withdrawn',
          before_text: 'Активен',
          after_text: 'Отписан · Друго · без секция',
          created_at: '2026-10-19T12:00:00.000Z',
        },
      ]),
    ).toHaveLength(1)
  })

  it('appends Brevo outcome without blocking copy', () => {
    expect(brevoOutcomeAuditSuffix({ ok: true, action: 'removed', detail: 'махнат от списък 94' })).toBe(
      ' · Brevo: махнат от списък 94',
    )
    expect(brevoOutcomeAuditSuffix({ ok: false, action: 'removed', detail: 'timeout' })).toBe(' · Brevo (неуспех): timeout')
    expect(brevoOutcomeAuditSuffix({ ok: true, action: 'skipped', detail: 'липсва BREVO_API_KEY' })).toBe(
      ' · Brevo: липсва BREVO_API_KEY',
    )
  })
})

describe('unregister SQL', () => {
  it('clears draft and published seats and sets withdrawn metadata', () => {
    const sql = unregisterSql()
    expect(sql).toContain('withdrawn = 1')
    expect(sql).toContain('withdrawn_at = ?')
    expect(sql).toContain('withdrawn_by = ?')
    expect(sql).toContain('withdrawn_reason = ?')
    expect(sql).toContain('draft_section = NULL')
    expect(sql).toContain('published_section = NULL')
    expect(sql).toContain("COALESCE(withdrawn, 0) = 0")
    const restore = restoreSql()
    expect(restore).toContain('withdrawn = 0')
    expect(restore).toContain('withdrawn_at = NULL')
    expect(restore).toContain("COALESCE(withdrawn, 0) = 1")
    expect(unregisterMessage(0, false)).toContain('Няма активни')
    expect(unregisterMessage(2, true)).toContain('2 души')
    expect(unregisterMessage(2, true)).toContain('още')
  })
})

describe('roster exclusions for withdrawn', () => {
  it('hides withdrawn people from active filters and keeps a dedicated view', () => {
    expect(rosterWhere('withdrawn', '')).toEqual({ clause: 'COALESCE(withdrawn, 0) = 1', binds: [] })
    expect(rosterWhere('assigned', '')).toEqual({
      clause: "COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0",
      binds: [],
    })
    expect(rosterWhere('abroad', '')).toEqual({ clause: "region_code = '32' AND COALESCE(withdrawn, 0) = 0", binds: [] })
    expect(rosterWhere('all', '')).toEqual({ clause: '1 = 1', binds: [] })
    const distribution = distributionWhere('unassigned', '')
    expect('clause' in distribution && distribution.clause).toContain('COALESCE(withdrawn, 0) = 0')
  })

  it('marks admin unregister in the payload so /profil can keep self-service copy', () => {
    expect(unregisterSql()).toContain("'$.withdrawnByAdmin', json('true')")
    expect(restoreSql()).toContain("'$.withdrawnByAdmin', json('false')")
  })
})

describe('removeContactsFromList', () => {
  it('posts emails to the list remove endpoint', async () => {
    const config: BrevoConfig = {
      apiKey: 'test-key',
      listId: 94,
      templateId: null,
      senderEmail: 'team@tibroish.bg',
      senderName: 'Ти броиш',
    }
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    await removeContactsFromList(config, [' Ada@Example.com ', 'ada@example.com', ''], 94, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledOnce()
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toContain('/contacts/lists/94/contacts/remove')
    expect(JSON.parse(String(call[1].body))).toEqual({ emails: ['ada@example.com'] })
  })

  it('does not call Brevo when there are no emails', async () => {
    const config: BrevoConfig = {
      apiKey: 'test-key',
      listId: 94,
      templateId: null,
      senderEmail: 'team@tibroish.bg',
      senderName: 'Ти броиш',
    }
    const fetchImpl = vi.fn()
    await removeContactsFromList(config, ['  ', ''], 94, fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

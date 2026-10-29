// „Без имейл“ volunteers: one predicate for code and SQL; mail and Brevo never see them. Synthetic data only.
import { describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({ env: {} }))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHost: () => 'tibroish.bg' }))

import { importContactsToList, removeContactsFromList, type BrevoConfig } from './brevo'
import { pushDesignationLink, pushSectionContact, updateBrevoContactAttribute } from './designation-brevo'
import { deliverMail } from './mail'
import { hasRealEmail, isPlaceholderEmail, noEmailSql, realEmailSql, shownEmail } from './no-email'
import { brevoAddBestEffort, brevoWithdrawCleanup } from './withdrawal'
import { rosterWhere } from './admin-csv'
import { parseSignupSearch } from './admin-search'

const STAND_IN = 'bez-imeil-abcd1234@tibroish.invalid'
const config: BrevoConfig = { apiKey: 'test-key', listId: 95, templateId: null, senderEmail: 'team@example.test', senderName: 'Тест' }

describe('no-email predicate', () => {
  it('treats empty, missing and the stand-in as „Без имейл“', () => {
    for (const email of ['', '   ', null, undefined, STAND_IN, 'BEZ-IMEIL-X@TIBROISH.INVALID', 'no-at-sign']) expect(hasRealEmail(email)).toBe(false)
    expect(hasRealEmail('volunteer@example.org')).toBe(true)
    expect(isPlaceholderEmail(STAND_IN)).toBe(true)
    expect(isPlaceholderEmail('someone@tibroish.bg')).toBe(false)
    expect(shownEmail(STAND_IN)).toBe('')
    expect(shownEmail(' a@example.org ')).toBe('a@example.org')
  })

  it('SQL agrees with the code', async () => {
    const { DatabaseSync } = (await import(/* @vite-ignore */ 'node:sqlite')) as {
      DatabaseSync: new (path: string) => { exec(sql: string): void; prepare(sql: string): { all(): unknown[] } }
    }
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE t (id TEXT, email TEXT); INSERT INTO t VALUES ('real', 'a@example.org'), ('stand-in', '${STAND_IN}'),
      ('upper', 'X@TIBROISH.INVALID'), ('blank', '  '), ('null', NULL)`)
    expect(db.prepare(`SELECT id FROM t WHERE ${noEmailSql('email')} ORDER BY id`).all()).toEqual([{ id: 'blank' }, { id: 'null' }, { id: 'stand-in' }, { id: 'upper' }])
    expect(db.prepare(`SELECT id FROM t WHERE ${realEmailSql('t.email')}`).all()).toEqual([{ id: 'real' }])
  })
})

describe('„Без имейл“ filter on Записвания', () => {
  it('is a view of active people without an e-mail', () => {
    expect(rosterWhere('noemail', '')).toEqual({ clause: `${noEmailSql('email')} AND COALESCE(withdrawn, 0) = 0`, binds: [] })
    expect(parseSignupSearch({ view: 'noemail' }).view).toBe('noemail')
  })
})

describe('no mail and no Brevo for a volunteer without an e-mail', () => {
  it('deliverMail sends nothing', async () => {
    expect(await deliverMail({ to: STAND_IN, subject: 'x', text: 'x', html: 'x' })).toBe(false)
    expect(await deliverMail({ to: '', subject: 'x', text: 'x', html: 'x' })).toBe(false)
  })

  it('Brevo list import and removal skip stand-ins without calling Brevo', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ processId: 1 }), { status: 200 }))
    expect(await importContactsToList(config, [{ email: STAND_IN, attributes: {} }], 95, fetchImpl)).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    await importContactsToList(config, [{ email: STAND_IN, attributes: {} }, { email: 'a@example.org', attributes: {} }], 95, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledOnce()
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { jsonBody: Array<{ email: string }> }
    expect(body.jsonBody.map((row) => row.email)).toEqual(['a@example.org'])
    fetchImpl.mockClear()
    await removeContactsFromList(config, [STAND_IN], 95, fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('designation and section pushes are skipped, not failed', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
    const section = await pushSectionContact({ apiKey: 'k', listId: 95, personId: 's1', email: STAND_IN, attributes: {}, fetchImpl })
    expect(section).toMatchObject({ ok: false, skipped: true })
    const link = await pushDesignationLink({ apiKey: 'k', listId: 95, attribute: 'DOCUMENT_URL', contact: { personId: 's1', email: STAND_IN, url: 'https://drive.example/x' }, fetchImpl })
    expect(link).toMatchObject({ ok: false, skipped: true })
    await expect(updateBrevoContactAttribute('k', STAND_IN, { DOCUMENT_URL: 'x' }, fetchImpl)).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('withdrawal cleanup and re-add are clean no-ops', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
    expect(await brevoWithdrawCleanup(STAND_IN, () => config, fetchImpl)).toMatchObject({ ok: true, action: 'skipped' })
    expect(await brevoAddBestEffort(STAND_IN, 'Тест', 'Тестов')).toMatchObject({ ok: true, action: 'skipped' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

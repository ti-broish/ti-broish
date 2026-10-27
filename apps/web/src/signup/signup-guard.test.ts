import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditLines, describeAudit } from './admin-audit'
import {
  identityChanges,
  identityOf,
  maskEgn,
  OTHER_RECORD_MESSAGE,
  PENDING_LETTER_MESSAGE,
  saveDecision,
  selfActor,
  SIGN_IN_MESSAGE,
  type EmailRow,
  type SessionRow,
} from './signup-guard'

const staff: EmailRow = { id: 'staff-row', session_token: 'staff-token', imported: 0, email_confirmed: 1 }
const own: SessionRow = { id: 'own-row', email: 'ina@example.com', session_token: 'own-token', imported: 0, email_confirmed: 1, pending_email: null }

describe('saveSignup never takes over a record by its e-mail', () => {
  it('refuses an existing e-mail without that record’s session and points to /vhod', () => {
    const decision = saveDecision('Staff@Example.com ', null, staff)
    expect(decision).toEqual({ kind: 'refuse', reason: 'signin', message: SIGN_IN_MESSAGE })
    expect(SIGN_IN_MESSAGE).toContain('/vhod')
  })

  it('refuses an existing e-mail even when the browser holds another record', () => {
    expect(saveDecision('staff@example.com', own, staff)).toMatchObject({ kind: 'refuse', reason: 'other-record', message: OTHER_RECORD_MESSAGE })
  })

  it('keeps the guard for imported rows that wait for the letter', () => {
    const imported: EmailRow = { id: 'imp', session_token: 'imp-token', imported: 1, email_confirmed: 0 }
    expect(saveDecision('imp@example.com', null, imported)).toMatchObject({ kind: 'refuse', reason: 'pending-letter', message: PENDING_LETTER_MESSAGE })
    expect(saveDecision('imp@example.com', own, imported)).toMatchObject({ kind: 'refuse', reason: 'pending-letter' })
  })

  it('writes the browser’s own record once the code put its session here', () => {
    const decision = saveDecision('ina@example.com', own, { id: 'own-row', session_token: 'own-token', imported: 0, email_confirmed: 1 })
    expect(decision).toMatchObject({ kind: 'own', email: 'ina@example.com', emailConfirmed: true })
    expect(decision.kind === 'own' && decision.row.id).toBe('own-row')
  })

  it('says nothing for the row a code request just made: the form goes on to the code step', () => {
    const awaiting: EmailRow = { id: 'fresh', session_token: 'fresh-token', imported: 0, email_confirmed: 0 }
    expect(saveDecision('fresh@example.com', null, awaiting)).toEqual({ kind: 'refuse', reason: 'awaiting-code', message: '' })
  })

  it('starts a new record for a new e-mail without a session', () => {
    expect(saveDecision('new@example.com', null, null)).toEqual({ kind: 'new' })
  })
})

describe('the typed e-mail is never silently swapped for the session’s', () => {
  it('refuses a different e-mail on a confirmed session and names the signed-in address', () => {
    const decision = saveDecision('ivo@example.com', own, null)
    expect(decision).toMatchObject({ kind: 'refuse', reason: 'session-email' })
    expect(decision.kind === 'refuse' && decision.message).toContain('ina@example.com')
    expect(decision.kind === 'refuse' && decision.message).toContain('Запиши друг човек')
  })

  it('allows the e-mail change that waits for its code, and the row keeps the old address until then', () => {
    expect(saveDecision('ina.new@example.com', { ...own, pending_email: 'ina.new@example.com' }, null)).toMatchObject({ kind: 'own', email: 'ina@example.com' })
  })

  it('lets an unconfirmed, self-made row follow the address still being typed', () => {
    const draft: SessionRow = { ...own, email: 'ina@', email_confirmed: 0 }
    expect(saveDecision('ina@example.com', draft, null)).toMatchObject({ kind: 'own', email: 'ina@example.com', emailConfirmed: false, renameFrom: 'ina@' })
  })

  it('never renames an imported row from the form', () => {
    expect(saveDecision('x@example.com', { ...own, email_confirmed: 0, imported: 1 }, null)).toMatchObject({ kind: 'refuse', reason: 'session-email' })
  })
})

describe('identity audit', () => {
  it('lists each changed field and masks the ЕГН', () => {
    const before = identityOf({ firstName: 'Илина', middleName: 'Симеонова', lastName: 'Мутафчиева', email: 'ina@example.com', phone: '0888' }, '8001016354')
    const after = identityOf({ firstName: 'Илиан', middleName: 'Петров', lastName: 'Петров', email: 'ina@example.com', phone: '0899' }, '9001017584')
    expect(identityChanges(before, after)).toEqual([
      { field: 'name', before: 'Илина Симеонова Мутафчиева', after: 'Илиан Петров Петров' },
      { field: 'phone', before: '0888', after: '0899' },
      { field: 'egn_last4', before: '••••••6354', after: '••••••7584' },
    ])
    expect(identityChanges(before, before)).toEqual([])
    expect(maskEgn('')).toBe('няма')
    expect(selfActor(' Ina@Example.com')).toBe('self:ina@example.com')
  })

  it('shows name, phone, e-mail and ЕГН lines in the admin history', () => {
    const rows = ['name', 'phone', 'email', 'egn_last4'].map((field, index) => ({ id: String(index), actor: 'self:a@b.bg', field, before_text: 'x', after_text: 'y', created_at: '2026-10-23T07:00:00.000Z' }))
    expect(auditLines(rows).map((line) => line.field)).toEqual(['name', 'phone', 'email', 'egn_last4'])
    expect(describeAudit('phone', '0888', '0899')).toBe('Телефон: 0888 → 0899')
  })
})

describe('saveSignup wiring', () => {
  const source = readFileSync(new URL('./db.ts', import.meta.url), 'utf8')
  const save = source.slice(source.indexOf('export const saveSignup'), source.indexOf('export const reportCantReach'))

  it('decides with saveDecision before any write and returns the refusal', () => {
    expect(save.indexOf('saveDecision(')).toBeGreaterThan(-1)
    expect(save.indexOf('saveDecision(')).toBeLessThan(save.indexOf('INSERT INTO signups'))
    expect(save).toMatch(/decision\.kind === 'refuse'\) return \{ ok: false as const, reason: decision\.reason/)
  })

  it('only hands out its own or a fresh session token, never one found by e-mail', () => {
    expect(save).toContain("const existing = decision.kind === 'own' ? decision.row : null")
    expect(save).not.toMatch(/bySession \?\? byEmail/)
    expect(save).not.toMatch(/email: bySession\.email/)
  })

  it('does not trust emailConfirmed from the form', () => {
    expect(save).toContain("{ ...data, emailConfirmed: false }")
  })

  it('audits identity changes of an existing record', () => {
    expect(save).toContain('identityChanges(')
    expect(save).toContain('IDENTITY_AUDIT_SQL')
  })
})

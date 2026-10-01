import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase } from './db-core'
import { confirmCodeMail, deliverMail, isDevMailHost } from './mail'
import { emptyProfile, validEmail } from './model'
import { signupColumns } from './record'

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function referralCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

function sixDigit() {
  return String((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 1_000_000).padStart(6, '0')
}

function sessionCookie(token: string) {
  setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: !isDevMailHost(), sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 180 })
}

function payloadConfirmed(payload: string, email: string) {
  try {
    const parsed = JSON.parse(payload) as { email?: string; emailConfirmed?: boolean }
    if (!parsed || typeof parsed !== 'object') return payload
    parsed.email = email
    parsed.emailConfirmed = true
    return JSON.stringify(parsed)
  } catch {
    return payload
  }
}

export const requestEmailCode = createServerFn({ method: 'POST' })
  .validator((input: { email: string; firstName: string; middleName: string; lastName: string; phone: string }) => input)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase()
    if (!validEmail(email)) return { sent: false, previewCode: '' }
    const db = await signupDatabase()
    if (!db) return { sent: false, previewCode: isDevMailHost() ? '000000' : '' }
    const code = sixDigit()
    const now = new Date().toISOString()
    const cookie = getCookie(SESSION_COOKIE)
    const session = cookie
      ? await db
          .prepare('SELECT id, email, payload FROM signups WHERE session_token = ?')
          .bind(cookie)
          .first<{ id: string; email: string; payload: string }>()
      : null
    if (session) {
      const same = session.email.trim().toLowerCase() === email
      if (!same) {
        const other = await db.prepare('SELECT id FROM signups WHERE email = ? AND id != ?').bind(email, session.id).first<{ id: string }>()
        if (other) return { sent: false, previewCode: '', conflict: true as const }
        await db.prepare('UPDATE signups SET pending_email = ?, email_code = ?, updated_at = ? WHERE id = ?').bind(email, code, now, session.id).run()
      } else {
        await db.prepare('UPDATE signups SET pending_email = NULL, email_code = ?, updated_at = ? WHERE id = ?').bind(code, now, session.id).run()
      }
      const sent = await deliverMail(confirmCodeMail(email, code))
      if (!sent) {
        if (!isDevMailHost()) {
          await db.prepare('UPDATE signups SET email_code = NULL, pending_email = NULL WHERE id = ?').bind(session.id).run()
        }
        return { sent: false, previewCode: isDevMailHost() ? code : '' }
      }
      return { sent: true, previewCode: '' }
    }
    const referral = referralCode()
    const columns = signupColumns({
      ...emptyProfile(),
      firstName: data.firstName,
      middleName: data.middleName,
      lastName: data.lastName,
      email,
      phone: data.phone,
      referralCode: referral,
    })
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await db
          .prepare(
            `INSERT INTO signups (
               id, email, session_token, referral_code, payload, email_confirmed, withdrawn, email_code, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
             ON CONFLICT(email) DO UPDATE SET email_code = excluded.email_code, updated_at = excluded.updated_at`,
          )
          .bind(crypto.randomUUID(), email, crypto.randomUUID(), attempt === 0 ? referral : referralCode(), columns.payload, code, now, now)
          .run()
        break
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/referral_code/i.test(message) || attempt === 3) throw error
      }
    }
    const sent = await deliverMail(confirmCodeMail(email, code))
    if (!sent) {
      if (!isDevMailHost()) {
        await db.prepare('UPDATE signups SET email_code = NULL WHERE email = ?').bind(email).run()
      }
      return { sent: false, previewCode: isDevMailHost() ? code : '' }
    }
    return { sent: true, previewCode: '' }
  })

/** A code for someone who already confirmed. Does not create a signup for an unknown address. */
export const requestSignInCode = createServerFn({ method: 'POST' })
  .validator((input: { email: string }) => input)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase()
    if (!validEmail(email)) return { status: 'invalid' as const, previewCode: '' }
    const db = await signupDatabase()
    if (!db) return { status: 'unavailable' as const, previewCode: '' }
    const row = await db.prepare('SELECT email_confirmed FROM signups WHERE email = ?').bind(email).first<{ email_confirmed: number | null }>()
    if (!row?.email_confirmed) return { status: 'missing' as const, previewCode: '' }
    const code = sixDigit()
    const now = new Date().toISOString()
    await db.prepare('UPDATE signups SET email_code = ?, updated_at = ? WHERE email = ?').bind(code, now, email).run()
    const sent = await deliverMail(confirmCodeMail(email, code))
    if (!sent) {
      if (!isDevMailHost()) {
        await db.prepare('UPDATE signups SET email_code = NULL WHERE email = ?').bind(email).run()
        return { status: 'failed' as const, previewCode: '' }
      }
      return { status: 'preview' as const, previewCode: code }
    }
    return { status: 'sent' as const, previewCode: '' }
  })

export const checkEmailCode = createServerFn({ method: 'POST' })
  .validator((input: { email: string; code: string }) => input)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase()
    const code = data.code.trim()
    const db = await signupDatabase()
    if (!db) return { ok: false }
    const pending = await db
      .prepare('SELECT id, payload, email_code, session_token FROM signups WHERE pending_email = ?')
      .bind(email)
      .first<{ id: string; payload: string; email_code: string | null; session_token: string | null }>()
    if (pending) {
      if (!code || pending.email_code !== code) return { ok: false }
      const taken = await db.prepare('SELECT id FROM signups WHERE email = ? AND id != ?').bind(email, pending.id).first<{ id: string }>()
      if (taken) return { ok: false }
      const now = new Date().toISOString()
      await db
        .prepare('UPDATE signups SET email = ?, email_confirmed = 1, email_code = NULL, pending_email = NULL, payload = ?, updated_at = ? WHERE id = ?')
        .bind(email, payloadConfirmed(pending.payload, email), now, pending.id)
        .run()
      if (pending.session_token) sessionCookie(pending.session_token)
      return { ok: true }
    }
    const row = await db
      .prepare('SELECT email_code, session_token FROM signups WHERE email = ?')
      .bind(email)
      .first<{ email_code: string | null; session_token: string | null }>()
    const expected = row?.email_code
    if (!code || !expected || code !== expected) return { ok: false }
    await db
      .prepare('UPDATE signups SET email_confirmed = 1, email_code = NULL, pending_email = NULL, updated_at = ? WHERE email = ?')
      .bind(new Date().toISOString(), email)
      .run()
    if (row?.session_token) sessionCookie(row.session_token)
    return { ok: true }
  })

export const previewImport = createServerFn({ method: 'POST' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const token = data.token.trim()
    const db = await signupDatabase()
    if (!db || token.length < 16) return { ok: false as const }
    const row = await db
      .prepare('SELECT payload, email, email_confirmed FROM signups WHERE confirm_token = ?')
      .bind(token)
      .first<{ payload: string; email: string; email_confirmed: number }>()
    if (!row) return { ok: false as const }
    const profile = JSON.parse(row.payload) as { firstName?: string }
    return { ok: true as const, firstName: profile.firstName ?? '', email: row.email, confirmed: row.email_confirmed === 1 }
  })

export const confirmImported = createServerFn({ method: 'POST' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const token = data.token.trim()
    const db = await signupDatabase()
    if (!db || token.length < 16) return { ok: false as const, message: 'Линкът не е валиден.' }
    const row = await db.prepare('SELECT session_token FROM signups WHERE confirm_token = ?').bind(token).first<{ session_token: string | null }>()
    if (!row?.session_token) return { ok: false as const, message: 'Линкът не е валиден.' }
    await db.prepare('UPDATE signups SET email_confirmed = 1, confirm_token = NULL, updated_at = ? WHERE confirm_token = ?').bind(new Date().toISOString(), token).run()
    sessionCookie(row.session_token)
    return { ok: true as const }
  })

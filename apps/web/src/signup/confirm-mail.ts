import { createServerFn } from '@tanstack/react-start'
import { setCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase } from './db-core'
import { confirmCodeMail, deliverMail } from './mail'
import { codeFor, emptyProfile, validEmail } from './model'
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
  setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 180 })
}

export const requestEmailCode = createServerFn({ method: 'POST' })
  .validator((input: { email: string; firstName: string; middleName: string; lastName: string; phone: string }) => input)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase()
    const previewCode = codeFor(email)
    if (!validEmail(email)) return { sent: false, previewCode }
    const db = await signupDatabase()
    if (!db) return { sent: false, previewCode }
    const code = sixDigit()
    const now = new Date().toISOString()
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
      await db.prepare('UPDATE signups SET email_code = NULL WHERE email = ?').bind(email).run()
      return { sent: false, previewCode }
    }
    return { sent: true, previewCode: '' }
  })

export const checkEmailCode = createServerFn({ method: 'POST' })
  .validator((input: { email: string; code: string }) => input)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase()
    const code = data.code.trim()
    const db = await signupDatabase()
    if (!db) return { ok: code === codeFor(email) }
    const row = await db
      .prepare('SELECT email_code, session_token FROM signups WHERE email = ?')
      .bind(email)
      .first<{ email_code: string | null; session_token: string | null }>()
    const expected = row?.email_code || codeFor(email)
    if (!code || code !== expected) return { ok: false }
    await db.prepare('UPDATE signups SET email_confirmed = 1, email_code = NULL, updated_at = ? WHERE email = ?').bind(new Date().toISOString(), email).run()
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

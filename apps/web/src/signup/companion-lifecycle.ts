import { getRequestUrl } from '@tanstack/react-start/server'
import { signupDatabase } from './db-core'
import { companionConfirmMail, deliverMail } from './mail'
import type { Companion } from './model'

function origin() {
  const url = getRequestUrl()
  return `${url.protocol}//${url.host}`
}

function secretToken() {
  return `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
}

/** Persist companion rows and email confirm links for newly pending people. */
export async function syncCompanions(
  db: NonNullable<Awaited<ReturnType<typeof signupDatabase>>>,
  signupId: string,
  companions: Companion[],
) {
  const previous = await db
    .prepare('SELECT id, email, email_confirmed, confirm_token FROM companions WHERE signup_id = ?')
    .bind(signupId)
    .all<{ id: string; email: string; email_confirmed: number | null; confirm_token: string | null }>()
  const prior = new Map((previous.results ?? []).map((row) => [row.id, row]))
  const mailed: { email: string; link: string }[] = []
  const nextCompanions: Companion[] = []
  const kept = new Set<string>()
  for (const person of companions) {
    const id = person.id || crypto.randomUUID()
    kept.add(id)
    const email = person.email.trim().toLowerCase()
    const old = prior.get(id)
    const sameEmail = Boolean(old && old.email === email)
    // Only a stored confirm, or the same email still confirmed, counts. The client cannot set this.
    const confirmed = Boolean(sameEmail && old?.email_confirmed === 1)
    let token = confirmed ? null : sameEmail && old?.confirm_token ? old.confirm_token : null
    const freshToken = Boolean(!confirmed && email && !token)
    if (freshToken) token = secretToken()
    const values = [
      person.inGroup === false ? 0 : 1,
      person.firstName,
      person.middleName,
      person.lastName,
      email,
      person.phone,
      person.role,
      person.samePlace ? 1 : 0,
      confirmed ? 1 : 0,
      token,
    ]
    if (old) {
      await db
        .prepare(
          `UPDATE companions SET
             in_group = ?, first_name = ?, middle_name = ?, last_name = ?, email = ?, phone = ?, role = ?, same_place = ?, email_confirmed = ?, confirm_token = ?
           WHERE id = ? AND signup_id = ?`,
        )
        .bind(...values, id, signupId)
        .run()
    } else {
      await db
        .prepare(
          `INSERT INTO companions (
             id, signup_id, in_group, first_name, middle_name, last_name, email, phone, role, same_place, email_confirmed, confirm_token
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, signupId, ...values)
        .run()
    }
    if (freshToken && token) {
      const link = `${origin()}/potvardi?companion=${token}`
      const sent = await deliverMail(companionConfirmMail(email, link))
      if (!sent) mailed.push({ email, link })
    }
    nextCompanions.push({
      ...person,
      id,
      email,
      status: confirmed ? 'confirmed' : 'pending',
    })
  }
  for (const row of previous.results ?? []) {
    if (!kept.has(row.id)) await db.prepare('DELETE FROM companions WHERE id = ? AND signup_id = ?').bind(row.id, signupId).run()
  }
  return { companions: nextCompanions, pendingLinks: mailed }
}

export async function companionsForSignup(
  db: NonNullable<Awaited<ReturnType<typeof signupDatabase>>>,
  signupId: string,
  profileCompanions: Companion[],
) {
  const rows = await db
    .prepare(
      `SELECT id, email, COALESCE(email_confirmed, 0) AS email_confirmed
       FROM companions WHERE signup_id = ?`,
    )
    .bind(signupId)
    .all<{ id: string; email: string; email_confirmed: number }>()
  const byId = new Map((rows.results ?? []).map((row) => [row.id, row]))
  return profileCompanions.map((person) => {
    const row = byId.get(person.id)
    if (!row) return person
    return { ...person, status: row.email_confirmed === 1 ? ('confirmed' as const) : ('pending' as const) }
  })
}


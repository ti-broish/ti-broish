import { createServerFn } from '@tanstack/react-start'
import { signupDatabase } from './db-core'
import type { Profile } from './model'

export const previewCompanion = createServerFn({ method: 'POST' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const token = data.token.trim()
    const db = await signupDatabase()
    if (!db || token.length < 16) return { ok: false as const }
    const row = await db
      .prepare(
        `SELECT c.first_name AS first_name, c.email AS email, COALESCE(c.email_confirmed, 0) AS email_confirmed
         FROM companions c
         WHERE c.confirm_token = ?`,
      )
      .bind(token)
      .first<{ first_name: string; email: string; email_confirmed: number }>()
    if (!row) return { ok: false as const }
    return {
      ok: true as const,
      firstName: row.first_name,
      email: row.email,
      confirmed: row.email_confirmed === 1,
      kind: 'companion' as const,
    }
  })

export const confirmCompanion = createServerFn({ method: 'POST' })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const token = data.token.trim()
    const db = await signupDatabase()
    if (!db || token.length < 16) return { ok: false as const, message: 'Линкът не е валиден.' }
    const row = await db
      .prepare(
        `SELECT c.id AS id, c.signup_id AS signup_id, s.payload AS payload
         FROM companions c JOIN signups s ON s.id = c.signup_id
         WHERE c.confirm_token = ?`,
      )
      .bind(token)
      .first<{ id: string; signup_id: string; payload: string }>()
    if (!row) return { ok: false as const, message: 'Линкът не е валиден или вече е използван.' }
    const now = new Date().toISOString()
    await db.prepare('UPDATE companions SET email_confirmed = 1, confirm_token = NULL WHERE id = ?').bind(row.id).run()
    try {
      const profile = JSON.parse(row.payload) as Profile
      profile.companions = (profile.companions ?? []).map((person) => (person.id === row.id ? { ...person, status: 'confirmed' as const } : person))
      await db.prepare('UPDATE signups SET payload = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(profile), now, row.signup_id).run()
    } catch {
      // The companion row is already confirmed. A bad payload should not undo that.
    }
    return { ok: true as const, message: 'Имейлът е потвърден. Благодаря!' }
  })

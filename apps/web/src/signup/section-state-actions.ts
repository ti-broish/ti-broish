import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows } from './staff'
import { unpublishSql } from './section-state'

async function publishGate(): Promise<{ ok: true; db: SignupD1; email: string } | { ok: false; message: string }> {
  const db = await signupDatabase()
  if (!db) return { ok: false, message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false, message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{ email: string; email_confirmed: number }>()
  if (!session?.email_confirmed) return { ok: false, message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  if (!roleAllows(parseStaffRole(member?.role), 'publish')) return { ok: false, message: 'Тази роля няма това право.' }
  return { ok: true, db, email }
}

/** Unpublish one person: no email, no Brevo. The section stays as a manual draft. */
export const adminUnpublish = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => ({ id: String(input?.id ?? '') }))
  .handler(async ({ data }) => {
    const access = await publishGate()
    if (!access.ok) return access
    const db = access.db
    const row = await db
      .prepare(`SELECT COALESCE(draft_section, '') AS draft, COALESCE(published_section, '') AS published FROM signups WHERE id = ?`)
      .bind(data.id)
      .first<{ draft: string; published: string }>()
    if (!row?.published) return { ok: false as const, message: 'Няма публикувана секция.' }
    const now = new Date().toISOString()
    try {
      await db.prepare(unpublishSql(!row.draft)).bind(now, data.id).run()
    } catch {
      // Copying the section into an empty draft can trip a reservation trigger; then leave no draft.
      await db.prepare(unpublishSql(false)).bind(now, data.id).run()
    }
    await db
      .prepare(`INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), data.id, access.email, 'Секция', `Публикувана ${row.published}`, `Чернова ${row.draft || row.published} (махнато публикуване)`, now)
      .run()
    return { ok: true as const, message: `Секция ${row.published} вече не е публикувана. Остава като ръчна чернова. Без имейл.` }
  })

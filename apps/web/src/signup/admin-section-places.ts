import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { normalizeSection } from './admin-csv'
import { SESSION_COOKIE, signupDatabase } from './db-core'
import { lookupSectionPlaces } from './section-places-lookup'
import type { SectionSpot } from './section-where'
import { parseStaffRole, roleAllows } from './staff'

export const adminSectionPlaces = createServerFn({ method: 'POST' })
  .validator((input: { codes?: string[]; townIds?: number[] }) => ({
    codes: [...new Set((input.codes ?? []).map((code) => normalizeSection(String(code))).filter((code) => /^\d{9}$/.test(code)))].slice(0, 200),
    townIds: [...new Set((input.townIds ?? []).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 40),
  }))
  .handler(async ({ data }) => {
    const access = await gate()
    if (!access.ok) return access
    if (data.codes.length === 0) return { ok: true as const, places: {} as Record<string, SectionSpot> }
    const townIdsByCode: Record<string, number[]> = {}
    for (const code of data.codes) townIdsByCode[code] = data.townIds
    const places = await lookupSectionPlaces(data.codes, townIdsByCode)
    return { ok: true as const, places }
  })

async function gate() {
  const db = await signupDatabase()
  if (!db) return { ok: false as const, message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false as const, message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{ email: string; email_confirmed: number }>()
  if (!session?.email_confirmed) return { ok: false as const, message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role || !roleAllows(role, 'view')) return { ok: false as const, message: 'Този имейл не е поканен в екипа.' }
  return { ok: true as const }
}

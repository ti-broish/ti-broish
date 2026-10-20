import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { normalizeSection } from './admin-csv'
import { resolveAssignedSectionPlace } from './assigned-section-resolve'
import { SESSION_COOKIE, signupDatabase } from './db-core'

/** The signed-in person's published section and where it is. Only the session's own published section. */
export const loadAssignedSectionPlace = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await signupDatabase()
  const token = getCookie(SESSION_COOKIE)
  if (!db || !token) return null
  const row = await db
    .prepare(
      `SELECT COALESCE(published_section, '') AS published_section, json_extract(payload, '$.place.townId') AS town_id
       FROM signups WHERE session_token = ? AND COALESCE(withdrawn, 0) = 0`,
    )
    .bind(token)
    .first<{ published_section: string; town_id: number | string | null }>()
  const section = normalizeSection(row?.published_section ?? '')
  if (!/^\d{9}$/.test(section)) return null
  const townId = Number(row?.town_id)
  const place = await resolveAssignedSectionPlace(section, Number.isInteger(townId) && townId > 0 ? [townId] : [])
  return { section, place }
})

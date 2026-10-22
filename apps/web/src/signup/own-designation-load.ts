import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase } from './db-core'
import { OWN_DESIGNATION_SQL, ownDesignation, type OwnDesignation, type OwnDesignationRow } from './own-designation'

/** The session's own пълномощно for the profile card: number, МИР, section. No Drive id or link. */
export const loadOwnDesignation = createServerFn({ method: 'GET' }).handler(async (): Promise<OwnDesignation | null> => {
  const token = getCookie(SESSION_COOKIE)
  if (!token) return null
  const db = await signupDatabase()
  if (!db) return null
  const row = await db.prepare(OWN_DESIGNATION_SQL).bind(token).first<OwnDesignationRow>()
  return ownDesignation(row)
})

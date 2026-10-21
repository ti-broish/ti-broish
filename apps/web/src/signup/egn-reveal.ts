import { roleAllows, type StaffRole } from './staff'

/**
 * „Покажи ЕГН“ on admin profiles. The ЕГН never ships with the profile (only „ЕГН е въведено“);
 * an admin asks for it with one POST that is audited and not cached.
 */

/** signup_audit.field for one reveal. The audit row never holds the number itself. */
export const EGN_REVEAL_FIELD = 'egn_revealed'
export const EGN_REVEAL_AFTER = 'показано на екрана'

export const EGN_NO_STORE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, no-cache, must-revalidate, private, max-age=0',
  pragma: 'no-cache',
  expires: '0',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const

export function canRevealEgn(role: StaffRole | null) {
  return roleAllows(role, 'revealEgn')
}

export function egnDigits(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '')
}

/** URL of the reveal endpoint for one person (signup id or „И аз“ partner id). */
export function egnRevealPath(personId: string) {
  return `/admin/signups/${encodeURIComponent(personId)}/egn`
}

/**
 * A reveal must come from our own admin page: a cross-site form or fetch is refused even with the
 * session cookie. Browsers send Origin on POST and Sec-Fetch-Site where supported.
 */
export function sameOriginReveal(headers: { get(name: string): string | null }, requestUrl: string) {
  const site = headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return false
  const origin = headers.get('origin')
  if (!origin) return site === 'same-origin'
  try {
    return new URL(origin).origin === new URL(requestUrl).origin
  } catch {
    return false
  }
}

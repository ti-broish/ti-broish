/**
 * Volunteers without an e-mail („Без имейл“, Harry 29.10.2026). Staff add them on Записвания with
 * the „Без имейл“ switch; the record carries a stand-in address `bez-imeil-<random>@tibroish.invalid`
 * (RFC 2606: .invalid never resolves), because signups.email is NOT NULL UNIQUE and every reader
 * expects a string. An empty or missing address means the same thing.
 *
 * Such a person is never a Brevo contact and never gets a letter: every mail and Brevo path checks
 * hasRealEmail() (code) or realEmailSql() (SQL) and skips them quietly, without counting a failure.
 * They still get a пълномощно number in their МИР and go through signing like anyone else.
 * Client-safe: no Worker imports.
 */

export const PLACEHOLDER_EMAIL_DOMAIN = 'tibroish.invalid'

/** What the admin shows instead of the stand-in address. */
export const NO_EMAIL_LABEL = 'Без имейл'

/** The stand-in address for a volunteer added without an e-mail (…@tibroish.invalid). */
export function isPlaceholderEmail(email: string | null | undefined) {
  return /@tibroish\.invalid$/i.test(String(email ?? '').trim())
}

/** A real address: not empty, has an @, and is not the …@tibroish.invalid stand-in. */
export function hasRealEmail(email: string | null | undefined) {
  const value = String(email ?? '').trim()
  return value !== '' && value.includes('@') && !isPlaceholderEmail(value)
}

/** The address to show in the admin: the address itself, or '' for a person without one. */
export function shownEmail(email: string | null | undefined) {
  return hasRealEmail(email) ? String(email).trim() : ''
}

/** SQL: the row has no real e-mail (NULL, empty, or the stand-in). `column` e.g. 'email' or 's.email'. */
export function noEmailSql(column = 'email') {
  return `(COALESCE(TRIM(${column}), '') = '' OR LOWER(TRIM(${column})) LIKE '%@${PLACEHOLDER_EMAIL_DOMAIN}')`
}

/** SQL: the row has a real e-mail; the only rows Brevo or mail may ever see. */
export function realEmailSql(column = 'email') {
  return `NOT ${noEmailSql(column)}`
}

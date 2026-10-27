import type { SignupD1 } from './db-core'

// One active signup per ЕГН. The ЕГН is kept as plain digits in signups.egn (not hashed); older rows typed by
// hand may carry spaces, so the lookup compares the same normalized key the пълномощно checks use
// (identity-fix.ts EGN_TAKEN_SQL). A withdrawn (отписан) signup never blocks a new one, and the person's own
// row never blocks itself. There is deliberately no UNIQUE constraint: production may already hold
// duplicates, and those rows keep saving as long as their ЕГН is not changed.

/** What the person sees. It names neither the other signup's e-mail nor its name. */
export const EGN_IN_USE_MESSAGE =
  'Това ЕГН вече е използвано в друго записване. Ако е твоето, влез през /vhod с имейла, с който си се записал(а). Ако смяташ, че е грешка, пиши ни на team@tibroish.bg.'

export const EGN_KEY_SQL = "REPLACE(TRIM(COALESCE(egn, '')), ' ', '')"

/** Index for the lookup below; the expression must match EGN_IN_USE_SQL exactly for SQLite to use it. */
export const EGN_KEY_INDEX = `CREATE INDEX IF NOT EXISTS idx_signups_egn_key ON signups(${EGN_KEY_SQL})`

export const EGN_IN_USE_SQL = `SELECT 1 AS hit FROM signups WHERE ${EGN_KEY_SQL} = ?1 AND id != ?2 AND COALESCE(withdrawn, 0) = 0 LIMIT 1`

export function egnDigits(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '')
}

/** Only a new or changed ЕГН is checked, so a record that already shares one keeps saving its other fields. */
export function egnNeedsCheck(typed: string | null | undefined, stored: string | null | undefined) {
  const next = egnDigits(typed)
  return next !== '' && next !== egnDigits(stored)
}

/** Whether another active signup (not `ownId`) already holds this ЕГН. */
export async function egnUsedElsewhere(db: SignupD1, egn: string, ownId: string | null) {
  const key = egnDigits(egn)
  if (!key) return false
  const hit = await db.prepare(EGN_IN_USE_SQL).bind(key, ownId ?? '').first<{ hit: number }>()
  return Boolean(hit)
}

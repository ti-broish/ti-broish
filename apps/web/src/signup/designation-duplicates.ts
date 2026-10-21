/**
 * One person, one пълномощно. The ЕГН is the person, across signups and „И аз“ partner people:
 * once an ЕГН holds a number (an active signup, or a partner row that is not withdrawn), no
 * other row with that ЕГН gets one, and a second numbered row is a duplicate that never goes
 * to a ZIP for signing, a signed wave or a „call the РИК“ task.
 *
 * Who keeps the number when two already hold one: a signup with a published section, then any
 * other active signup, then a partner row; within the same rank the lower number (then id).
 * Client-safe: SQL strings and pure helpers only. ЕГН never leaves the server.
 */

/** Normalised ЕГН of a column: spaces dropped, '' when missing. */
export const egnKeySql = (column: string) => `REPLACE(TRIM(COALESCE(${column}, '')), ' ', '')`

export function egnKey(value: string | null | undefined) {
  return String(value ?? '').replace(/\s+/g, '')
}

/** A signup that holds a number and counts: numbered, not withdrawn. Alias-qualified. */
const signupHolds = (alias: string) => `${alias}.designation_number IS NOT NULL AND COALESCE(${alias}.withdrawn, 0) = 0`
/** A partner row that holds a number and counts: numbered, not withdrawn. Alias-qualified. */
const partnerHolds = (alias: string) => `${alias}.designation_number IS NOT NULL AND ${alias}.withdrawn_at IS NULL`
const signupRank = (alias: string) => `(CASE WHEN COALESCE(${alias}.published_section, '') != '' THEN 0 ELSE 1 END)`
const sameEgn = (a: string, b: string) => `${egnKeySql(`${b}.egn`)} != '' AND ${egnKeySql(`${a}.egn`)} = ${egnKeySql(`${b}.egn`)}`

/**
 * Guard for numbering signup `outer` (a table name or alias): its ЕГН holds no number yet
 * in either table. Used inside the assign UPDATE, so parallel runs cannot both number one ЕГН.
 */
export const signupEgnFreeSql = (outer = 'signups') => `NOT EXISTS (SELECT 1 FROM signups o WHERE o.id != ${outer}.id AND ${signupHolds('o')} AND ${sameEgn('o', outer)})
  AND NOT EXISTS (SELECT 1 FROM partner_people o WHERE ${partnerHolds('o')} AND ${sameEgn('o', outer)})`

/**
 * Guard for numbering partner row `outer`: not withdrawn, its ЕГН holds no number in either
 * table, and it is not covered by an active volunteer (marked on import).
 */
export const partnerEgnFreeSql = (outer = 'partner_people') => `${outer}.withdrawn_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM signups o WHERE ${signupHolds('o')} AND ${sameEgn('o', outer)})
  AND NOT EXISTS (SELECT 1 FROM partner_people o WHERE o.id != ${outer}.id AND ${partnerHolds('o')} AND ${sameEgn('o', outer)})
  AND NOT EXISTS (SELECT 1 FROM signups c WHERE c.id = ${outer}.covered_by_signup_id AND COALESCE(c.withdrawn, 0) = 0)`

/** True for a numbered signup `outer` that is not the one keeping the number for its ЕГН. */
export const signupDuplicateSql = (outer = 'signups') => `EXISTS (SELECT 1 FROM signups o WHERE o.id != ${outer}.id AND ${signupHolds('o')} AND ${sameEgn('o', outer)}
    AND (${signupRank('o')} < ${signupRank(outer)}
      OR (${signupRank('o')} = ${signupRank(outer)} AND (o.designation_number < ${outer}.designation_number
        OR (o.designation_number = ${outer}.designation_number AND o.id < ${outer}.id)))))`

/** True for a numbered partner row `outer` whose ЕГН is kept by an active signup or a lower partner row. */
export const partnerDuplicateSql = (outer = 'partner_people') => `(EXISTS (SELECT 1 FROM signups o WHERE ${signupHolds('o')} AND ${sameEgn('o', outer)})
  OR EXISTS (SELECT 1 FROM partner_people o WHERE o.id != ${outer}.id AND ${partnerHolds('o')} AND ${sameEgn('o', outer)}
    AND (o.designation_number < ${outer}.designation_number OR (o.designation_number = ${outer}.designation_number AND o.id < ${outer}.id))))`

/** Every row that holds a number and counts, with its ЕГН key. Server-only: the key never reaches the page. */
export const EGN_HOLDERS_SQL = `SELECT id, 'signup' AS kind, ${egnKeySql('egn')} AS egn_key, COALESCE(designation_mir, '') AS mir,
    designation_number AS number, CASE WHEN COALESCE(published_section, '') != '' THEN 1 ELSE 0 END AS published
  FROM signups s WHERE ${signupHolds('s')} AND ${egnKeySql('egn')} != ''
UNION ALL
SELECT id, 'partner' AS kind, ${egnKeySql('egn')} AS egn_key, COALESCE(designation_mir, '') AS mir,
    designation_number AS number, 0 AS published
  FROM partner_people p WHERE ${partnerHolds('p')} AND ${egnKeySql('egn')} != ''`

export interface EgnHolder {
  id: string
  kind: 'signup' | 'partner'
  egnKey: string
  mir: string
  number: number
  published: boolean
}

export function holderFromRow(row: { id: string; kind: string; egn_key: string; mir: string | null; number: number | string | null; published: number | null }): EgnHolder | null {
  const number = Number(row.number)
  if (!row.egn_key || !Number.isFinite(number)) return null
  return {
    id: row.id,
    kind: row.kind === 'partner' ? 'partner' : 'signup',
    egnKey: row.egn_key,
    mir: String(row.mir ?? ''),
    number,
    published: Number(row.published) === 1,
  }
}

function rank(holder: EgnHolder) {
  if (holder.kind === 'signup') return holder.published ? 0 : 1
  return 2
}

function better(a: EgnHolder, b: EgnHolder) {
  return rank(a) - rank(b) || a.number - b.number || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** The row keeping the number for each ЕГН (same order as the SQL above). */
export function keepersByEgn(holders: EgnHolder[]) {
  const keep = new Map<string, EgnHolder>()
  for (const holder of holders) {
    const current = keep.get(holder.egnKey)
    if (!current || better(holder, current) < 0) keep.set(holder.egnKey, holder)
  }
  return keep
}

export interface DuplicateMark {
  /** Number and МИР of the row that keeps the пълномощно for this ЕГН. */
  number: number
  mir: string
  keeperId: string
}

/** The keeper for a person's ЕГН when it is another row; null when this person is the keeper or the ЕГН is free. */
export function duplicateOf(person: { id: string; egnKey: string }, keepers: Map<string, EgnHolder>): DuplicateMark | null {
  if (!person.egnKey) return null
  const keeper = keepers.get(person.egnKey)
  if (!keeper || keeper.id === person.id) return null
  return { number: keeper.number, mir: keeper.mir, keeperId: keeper.id }
}

export interface GuardCandidate {
  id: string
  kind: 'signup' | 'partner'
  egnKey: string
  /** Partner only: covered by an active volunteer (marked on import). */
  covered?: boolean
  /** Partner only: withdrawn. */
  withdrawn?: boolean
}

export type GuardSkip = { id: string; reason: 'duplicate' | 'covered' | 'withdrawn'; keeper: DuplicateMark | null }

/**
 * Who of the unnumbered may get a number in this run. Volunteers come first (their order kept),
 * then partner rows. An ЕГН already holding a number, or claimed earlier in this run, is skipped.
 */
export function planEgnGuard(candidates: GuardCandidate[], holders: EgnHolder[]) {
  const keepers = keepersByEgn(holders)
  const claimed = new Map<string, DuplicateMark>()
  for (const [key, keeper] of keepers) claimed.set(key, { number: keeper.number, mir: keeper.mir, keeperId: keeper.id })
  const ordered = [...candidates.filter((row) => row.kind === 'signup'), ...candidates.filter((row) => row.kind === 'partner')]
  const allowed = new Set<string>()
  const skipped: GuardSkip[] = []
  for (const row of ordered) {
    if (row.kind === 'partner' && row.withdrawn) {
      skipped.push({ id: row.id, reason: 'withdrawn', keeper: null })
      continue
    }
    const key = row.egnKey
    const held = key ? claimed.get(key) : undefined
    if (held) {
      skipped.push({ id: row.id, reason: 'duplicate', keeper: held })
      continue
    }
    if (row.kind === 'partner' && row.covered) {
      skipped.push({ id: row.id, reason: 'covered', keeper: null })
      continue
    }
    allowed.add(row.id)
    // Claimed in this run: the number is not known until the UPDATE runs.
    if (key) claimed.set(key, { number: 0, mir: '', keeperId: row.id })
  }
  return { allowed, skipped }
}

/** Badge text on /admin/palnomoshtni. */
export function duplicateBadge(mark: DuplicateMark) {
  return mark.number > 0 ? `Дубликат: същото ЕГН има № ${mark.number}` : 'Дубликат: същото ЕГН е в този списък'
}

export const COVERED_LABEL = 'покрит от доброволец'
export const WITHDRAWN_PARTNER_LABEL = 'Оттеглено'

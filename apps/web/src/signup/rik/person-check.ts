/**
 * „Провери в РИК“: reads the представители register of one person's РИК right away (the cron's sync,
 * scoped to that one РИК: statuses and tasks of other РИК are left alone) and returns that person's
 * status. Admin-only, read-only towards the РИК site, like the cron.
 *
 * Throttled per РИК: when the РИК was read (by the cron or another click) under
 * MANUAL_CHECK_THROTTLE_SECONDS ago, nothing is fetched and the stored result is returned. The claim
 * is one conditional UPDATE of rik_sources.last_attempt_at, so two clicks at once fetch only once. A
 * РИК the site asked us to leave alone (blocked_until) is never fetched.
 */
import type { SignupD1 } from '../db-core'
import { MANUAL_CHECK_BUDGET, MANUAL_CHECK_THROTTLE_SECONDS } from './config'
import type { RikStatus } from './match'
import { RIK_PUBLISHED_STATUSES } from './people-filter'
import { createRikSync, ensureRikTables, type SyncOptions } from './sync'


export type PersonCheckOutcome =
  /** The register was read now. */
  | 'fetched'
  /** Read under MANUAL_CHECK_THROTTLE_SECONDS ago: the stored result. */
  | 'throttled'
  /** The site asked us to come back later: the stored result. */
  | 'blocked'
  /** The read failed (5xx, network, unrecognised page): the stored result. */
  | 'error'

export interface PersonCheckResult {
  ok: true
  outcome: PersonCheckOutcome
  mir: string
  /** null when the person has no rik_status row (yet). */
  status: RikStatus | null
  published: boolean
  /** Short Bulgarian line for the row. */
  message: string
  runId: string | null
}

export interface PersonCheckFailure {
  ok: false
  message: string
}

type CheckOptions = Pick<SyncOptions, 'now' | 'fetcher' | 'pauseMs' | 'sleep' | 'random' | 'retryDelaysMs' | 'budget'>

const PERSON_MIR_SQL = `SELECT COALESCE(designation_mir, '') AS mir FROM signups WHERE id = ?1 AND designation_number IS NOT NULL
UNION ALL
SELECT COALESCE(designation_mir, '') AS mir FROM partner_people WHERE id = ?1 AND designation_number IS NOT NULL`

function message(outcome: PersonCheckOutcome, published: boolean, mir: string, error: string) {
  const state = published ? 'публикуван' : 'още не е публикуван'
  if (outcome === 'fetched') return `Проверено: ${state}.`
  if (outcome === 'throttled') return `РИК ${mir} е четен преди под минута: ${state}.`
  if (outcome === 'blocked') return `Сайтът на РИК ${mir} помоли да изчакаме; последно: ${state}.`
  return `РИК ${mir} не се прочете${error ? ` (${error})` : ''}; последно: ${state}.`
}

/** Rows an UPDATE changed: D1 reports meta.changes (node:sqlite in tests: changes). */
function changesOf(result: unknown) {
  const value = result as { meta?: { changes?: number }; changes?: number | bigint } | null
  return Number(value?.meta?.changes ?? value?.changes ?? 0)
}

async function personStatus(db: SignupD1, personId: string) {
  const row = await db.prepare('SELECT status FROM rik_status WHERE person_id = ?').bind(personId).first<{ status: string }>()
  return row ? (String(row.status) as RikStatus) : null
}

export async function checkPersonInRik(db: SignupD1, personId: string, options: CheckOptions = {}): Promise<PersonCheckResult | PersonCheckFailure> {
  const now = options.now ?? (() => new Date())
  await ensureRikTables(db)
  const person = await db.prepare(PERSON_MIR_SQL).bind(personId).first<{ mir: string }>()
  const mir = person?.mir ? String(person.mir).padStart(2, '0') : ''
  if (!mir) return { ok: false, message: 'Човекът няма пълномощно с номер и МИР.' }

  const source = await db.prepare('SELECT last_attempt_at, blocked_until FROM rik_sources WHERE mir = ?').bind(mir).first<{ last_attempt_at: string | null; blocked_until: string | null }>()
  const stored = async (outcome: PersonCheckOutcome, error = ''): Promise<PersonCheckResult> => {
    const status = await personStatus(db, personId)
    const published = status != null && RIK_PUBLISHED_STATUSES.includes(status)
    return { ok: true, outcome, mir, status, published, message: message(outcome, published, mir, error), runId: null }
  }
  const at = now()
  if (source?.blocked_until && Date.parse(source.blocked_until) > at.getTime()) return stored('blocked')

  if (source) {
    // Claim the РИК: only when nobody read it in the last MANUAL_CHECK_THROTTLE_SECONDS.
    const stamp = at.toISOString()
    const since = new Date(at.getTime() - MANUAL_CHECK_THROTTLE_SECONDS * 1000).toISOString()
    const claim = await db
      .prepare('UPDATE rik_sources SET last_attempt_at = ? WHERE mir = ? AND (last_attempt_at IS NULL OR last_attempt_at <= ?)')
      .bind(stamp, mir, since)
      .run()
    if (changesOf(claim) === 0) return stored('throttled')
  }

  const summary = await createRikSync(db, {
    trigger: 'manual_person',
    mirs: [mir],
    force: true,
    quick: true,
    ...options,
    budget: Math.min(options.budget ?? MANUAL_CHECK_BUDGET, MANUAL_CHECK_BUDGET),
  }).run()
  const after = await db.prepare('SELECT health, last_error FROM rik_sources WHERE mir = ?').bind(mir).first<{ health: string; last_error: string }>()
  const outcome: PersonCheckOutcome = summary.blocked.includes(mir) ? 'blocked' : summary.synced.includes(mir) && after?.health !== 'unrecognised' ? 'fetched' : 'error'
  const result = await stored(outcome, outcome === 'error' ? String(after?.last_error ?? '').slice(0, 120) : '')
  return { ...result, runId: summary.runId }
}

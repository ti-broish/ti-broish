import { env } from 'cloudflare:workers'
import { signupDatabase, type SignupD1 } from '../db-core'
import { D1_RETRY_DELAYS_MS, DEFAULT_FETCH_BUDGET, RIK_SYNC_INTERVAL_MINUTES, RUN_TIME_LIMIT_MS } from './config'
import { createRikSync, failRikRun, startRikRun, type SyncOptions } from './sync'

/** Wall clock a cron invocation may use (Cloudflare: 15 min); the sync leaves a margin under it. */
const CRON_WALL_MS = 14 * 60_000
/** A gap this long since the previous cron run means at least one 15-min run never got to D1. */
export const MISSED_AFTER_MINUTES = RIK_SYNC_INTERVAL_MINUTES + 10

export interface ScheduledDeps {
  db?: SignupD1 | null
  /** The full signup schema (people). Defaults to signupDatabase(). */
  ready?: () => Promise<SignupD1 | null>
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  d1RetryDelaysMs?: number[]
  sync?: Partial<SyncOptions>
}

/** Runs a D1 step, waiting and retrying while D1 refuses (e.g. „Currently processing a long-running export“). */
export async function withD1Retry<T>(step: () => Promise<T>, delays: number[], sleep: (ms: number) => Promise<void>, label: string): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await step()
    } catch (error) {
      if (attempt >= delays.length) throw error
      console.warn(JSON.stringify({ event: 'rik-sync-d1-retry', step: label, attempt: attempt + 1, message: error instanceof Error ? error.message : String(error) }))
      await sleep(delays[attempt]!)
    }
  }
}

/** A row for cron runs that never reached D1 (seen only from the next run that does). */
async function recordMissed(db: SignupD1, runId: string, at: Date) {
  const previous = await db
    .prepare(`SELECT started_at FROM rik_runs WHERE trigger = 'cron' AND id != ? AND status != 'missed' ORDER BY started_at DESC LIMIT 1`)
    .bind(runId)
    .first<{ started_at: string }>()
  if (!previous) return
  const gap = (at.getTime() - Date.parse(previous.started_at)) / 60_000
  if (!(gap >= MISSED_AFTER_MINUTES)) return
  const missed = Math.max(1, Math.round(gap / RIK_SYNC_INTERVAL_MINUTES) - 1)
  const slot = new Date(Date.parse(previous.started_at) + RIK_SYNC_INTERVAL_MINUTES * 60_000).toISOString()
  await db
    .prepare(`INSERT INTO rik_runs (id, trigger, started_at, finished_at, status, note) VALUES (?, 'cron', ?, ?, 'missed', ?)`)
    .bind(crypto.randomUUID(), slot, slot, `Пропуснати пускания: ${missed} (D1 или Worker не отговори, виж логовете на Worker-а).`)
    .run()
}

/**
 * Cron entry: every РИК that is due, within the request budget and the time limit. Logs counts only,
 * never names. The rik_runs row is written first; if anything later throws, the row is marked
 * failed with the error, so every invocation that can reach D1 leaves a row.
 */
export async function runScheduledRikSync(cron: string, deps: ScheduledDeps = {}) {
  const now = deps.now ?? (() => new Date())
  const begun = now()
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const delays = deps.d1RetryDelaysMs ?? D1_RETRY_DELAYS_MS
  const vars = env as unknown as { DB?: SignupD1; RIK_SYNC_FETCH_BUDGET?: string; RIK_SYNC_DISABLED?: string }
  if (vars.RIK_SYNC_DISABLED === '1') return
  const raw = deps.db === undefined ? (vars.DB ?? null) : deps.db
  if (!raw) return
  const budget = Number(vars.RIK_SYNC_FETCH_BUDGET) || DEFAULT_FETCH_BUDGET
  let runId: string | null = null
  // One id for every try, so a retried insert that had in fact landed does not make a second row.
  const id = crypto.randomUUID()
  try {
    runId = await withD1Retry(() => startRikRun(raw, 'cron', begun, id), delays, sleep, 'start')
    const started = runId
    await recordMissed(raw, started, begun).catch(() => {})
    const db = await withD1Retry(async () => {
      const ready = await (deps.ready ?? signupDatabase)()
      if (!ready) throw new Error('Няма D1 база (DB).')
      return ready
    }, delays, sleep, 'schema')
    const left = CRON_WALL_MS - (now().getTime() - begun.getTime())
    const summary = await createRikSync(db, {
      trigger: 'cron',
      budget,
      runId: started,
      timeLimitMs: Math.max(60_000, Math.min(RUN_TIME_LIMIT_MS, left - 2 * 60_000)),
      ...deps.sync,
    }).run()
    console.log(
      JSON.stringify({
        event: 'rik-sync',
        cron,
        status: summary.status,
        fetched: summary.fetched,
        changed: summary.changed,
        errors: summary.errors,
        retries: summary.retries,
        blocked: summary.blocked,
        synced: summary.synced.length,
        skipped: summary.skipped.length,
        statuses: summary.statuses,
        tasks: summary.tasks,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ event: 'rik-sync-failed', cron, runId, message }))
    if (runId) {
      await withD1Retry(() => failRikRun(raw, id, now(), error), delays, sleep, 'fail').catch((again) =>
        console.error(JSON.stringify({ event: 'rik-sync-failed-unrecorded', cron, runId: id, message: again instanceof Error ? again.message : String(again) })),
      )
    }
  }
}

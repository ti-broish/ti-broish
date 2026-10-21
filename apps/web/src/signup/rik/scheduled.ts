import { env } from 'cloudflare:workers'
import { signupDatabase } from '../db-core'
import { DEFAULT_FETCH_BUDGET } from './config'
import { createRikSync } from './sync'

/** Cron entry: every РИК that is due, within the request budget. Logs counts only, never names. */
export async function runScheduledRikSync(cron: string) {
  const db = await signupDatabase()
  if (!db) return
  const vars = env as unknown as { RIK_SYNC_FETCH_BUDGET?: string; RIK_SYNC_DISABLED?: string }
  if (vars.RIK_SYNC_DISABLED === '1') return
  const budget = Number(vars.RIK_SYNC_FETCH_BUDGET) || DEFAULT_FETCH_BUDGET
  try {
    const summary = await createRikSync(db, { trigger: 'cron', budget }).run()
    console.log(
      JSON.stringify({
        event: 'rik-sync',
        cron,
        fetched: summary.fetched,
        changed: summary.changed,
        errors: summary.errors,
        synced: summary.synced.length,
        skipped: summary.skipped.length,
        statuses: summary.statuses,
        tasks: summary.tasks,
      }),
    )
  } catch (error) {
    console.error(JSON.stringify({ event: 'rik-sync-failed', cron, message: error instanceof Error ? error.message : String(error) }))
  }
}

/**
 * Production Cron Triggers (wrangler.jsonc env.production.triggers.crons, UTC) and what each runs.
 * The РИК sync runs every 15 minutes (:07, :22, :37, :52); the published-section pipeline (Brevo
 * contact calls) stays hourly at :07.
 */
export const HOURLY_CRON = '7 * * * *'
export const RIK_QUARTER_CRON = '22,37,52 * * * *'
export const PRODUCTION_CRONS = [HOURLY_CRON, RIK_QUARTER_CRON] as const

export interface ScheduledJobs {
  rik: boolean
  published: boolean
}

/** Every trigger reads the РИК; only the hourly one (or an unknown one, as before) runs the published pipeline. */
export function scheduledJobs(cron: string): ScheduledJobs {
  return { rik: true, published: cron !== RIK_QUARTER_CRON }
}

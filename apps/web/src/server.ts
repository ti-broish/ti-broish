/**
 * Worker entry: TanStack Start serves every request; the cron triggers run the РИК sync (every 15 min)
 * and the published-section pipeline (hourly, src/signup/published-pipeline.ts); see scheduled-jobs.ts.
 * See wrangler.jsonc „triggers“ (production only) and src/signup/rik/sync.ts.
 * `/` is the map of published signals (routes/index.tsx), not the 302 to /signal; site/home-redirect.ts
 * is kept so the redirect can be wired back here in one line.
 */
import handler from '@tanstack/react-start/server-entry'
import { runScheduledRikSync } from './signup/rik/scheduled'
import { runScheduledPublishedAdvance } from './signup/published-pipeline'
import { scheduledJobs } from './scheduled-jobs'

export default {
  fetch: handler.fetch,
  async scheduled(controller: { cron: string; scheduledTime: number }, _env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    const jobs = scheduledJobs(controller.cron)
    if (jobs.rik) ctx.waitUntil(runScheduledRikSync(controller.cron))
    // Published section → numbered, signing queue, Brevo contact (no mail). Backfill and catch-up. Hourly.
    if (jobs.published) ctx.waitUntil(runScheduledPublishedAdvance(controller.cron))
  },
}

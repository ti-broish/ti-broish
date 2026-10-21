/**
 * Worker entry: TanStack Start serves every request; the cron trigger runs the РИК sync.
 * See wrangler.jsonc „triggers“ (production only) and src/signup/rik/sync.ts.
 */
import handler from '@tanstack/react-start/server-entry'
import { runScheduledRikSync } from './signup/rik/scheduled'

export default {
  fetch: handler.fetch,
  async scheduled(controller: { cron: string; scheduledTime: number }, _env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduledRikSync(controller.cron))
  },
}

/**
 * Worker entry: TanStack Start serves every request; the cron trigger runs the РИК sync.
 * See wrangler.jsonc „triggers“ (production only) and src/signup/rik/sync.ts.
 * `/` is the map of published signals (routes/index.tsx), not the 302 to /signal; site/home-redirect.ts
 * is kept so the redirect can be wired back here in one line.
 */
import handler from '@tanstack/react-start/server-entry'
import { runScheduledRikSync } from './signup/rik/scheduled'

export default {
  fetch: handler.fetch,
  async scheduled(controller: { cron: string; scheduledTime: number }, _env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduledRikSync(controller.cron))
  },
}

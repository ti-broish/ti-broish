/**
 * Worker entry: TanStack Start serves every request; the cron trigger runs the РИК sync.
 * See wrangler.jsonc „triggers“ (production only) and src/signup/rik/sync.ts.
 */
import handler from '@tanstack/react-start/server-entry'
import { runScheduledRikSync } from './signup/rik/scheduled'
import { homeRedirect } from './site/home-redirect'

export default {
  // Election days: `/` is a temporary 302 to /signal, query string kept (site/home-redirect.ts).
  fetch(...args: Parameters<typeof handler.fetch>) {
    return homeRedirect(args[0]) ?? handler.fetch(...args)
  },
  async scheduled(controller: { cron: string; scheduledTime: number }, _env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduledRikSync(controller.cron))
  },
}

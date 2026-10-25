// The old Ти Броиш API (signals, sections, towns, the published feed).
// Production uses api.tibroish.bg. The staging worker is built with the staging API (d1tapi.tibroish.bg)
// so a test signal sent from d1t.tibroish.bg never reaches the real admin. vite.config.ts sets
// VITE_TIBROISH_API at build time: production builds (CLOUDFLARE_ENV=production) always get the production API,
// other builds the staging API, and `vite dev` (local, e2e) the production API that the specs mock.
import { isProductionHost } from '../home/violations'

export const PRODUCTION_API = 'https://api.tibroish.bg'
export const STAGING_API = 'https://d1tapi.tibroish.bg'

const ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i

/** The API origin for a build value, never a staging API on tibroish.bg itself. */
export function resolveApiBase(built: string | undefined, hostname?: string): string {
  if (hostname && isProductionHost(hostname)) return PRODUCTION_API
  const value = (built ?? '').trim().replace(/\/+$/, '')
  return ORIGIN.test(value) ? value : PRODUCTION_API
}

/** The API origin for this build, in the worker and in the browser. */
export function tibroishApi(): string {
  const built = import.meta.env.VITE_TIBROISH_API as string | undefined
  return resolveApiBase(built, typeof location === 'undefined' ? undefined : location.hostname)
}

/** The value vite.config.ts bakes into a build. */
export function buildApiBase(options: { command: 'build' | 'serve'; cloudflareEnv?: string; override?: string }): string {
  if (options.cloudflareEnv === 'production') return PRODUCTION_API
  if (options.override) return resolveApiBase(options.override)
  return options.command === 'build' ? STAGING_API : PRODUCTION_API
}

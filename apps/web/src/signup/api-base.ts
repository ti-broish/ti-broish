// Where the browser sends protocols: the Ти Броиш API. Production (tibroish.bg) uses api.tibroish.bg;
// staging (d1t.tibroish.bg), preview URLs and local dev use the staging API d1tapi.tibroish.bg,
// so testing never writes to the production API. VITE_TIBROISH_API at build time overrides both.
export const PRODUCTION_API = 'https://api.tibroish.bg'
export const STAGING_API = 'https://d1tapi.tibroish.bg'

const PRODUCTION_HOSTS = new Set(['tibroish.bg', 'www.tibroish.bg'])

export function isProductionHost(hostname: string) {
  return PRODUCTION_HOSTS.has(hostname.toLowerCase())
}

function currentHost() {
  return typeof window === 'undefined' ? 'tibroish.bg' : window.location.hostname
}

export function tiBroishApi(hostname = currentHost(), configured = (import.meta.env.VITE_TIBROISH_API as string | undefined) ?? '') {
  if (configured.trim()) return configured.trim().replace(/\/+$/, '')
  return isProductionHost(hostname) ? PRODUCTION_API : STAGING_API
}

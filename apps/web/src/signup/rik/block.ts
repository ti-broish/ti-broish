/**
 * Anti-bot and rate-limit pages from *.cik.bg (Cloudflare in front of CIK). The sync is a polite,
 * honest client: it never tries to solve or get around a challenge. It recognises one, records the
 * РИК as „blocked“ (keeping its last good data and tasks untouched) and stays away from that host
 * for a while (BLOCK_BACKOFF_MINUTES or the server's Retry-After, whichever is longer).
 */

export interface BlockCheck {
  status: number
  headers: Headers
  body: string
}

export interface BlockInfo {
  reason: string
  /** From Retry-After, when the server sent one. */
  retryAfterMs: number | null
}

/** Markers of challenge / block interstitials (Cloudflare and the usual captcha widgets). */
const CHALLENGE_MARKERS: Array<[RegExp, string]> = [
  [/<title>\s*Just a moment/i, 'Cloudflare challenge („Just a moment…“)'],
  [/_cf_chl_opt|cf-chl-|__cf_chl_|\/cdn-cgi\/challenge-platform\//i, 'Cloudflare challenge'],
  [/challenges\.cloudflare\.com|cf-turnstile/i, 'Cloudflare Turnstile'],
  [/<title>\s*Attention Required!\s*\|\s*Cloudflare/i, 'Cloudflare: Attention Required'],
  [/Sorry, you have been blocked|cf-error-details/i, 'Cloudflare: blocked'],
  [/g-recaptcha|hcaptcha\.com|class="h-captcha"/i, 'captcha'],
  [/<title>\s*(Access Denied|Request Rejected)\b/i, 'access denied page'],
]

/** Statuses whose body is read to look for markers (other non-200 bodies are not needed). */
export function mayBeBlockPage(status: number) {
  return status === 200 || status === 403 || status === 429 || status === 503
}

export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const at = Date.parse(trimmed)
  return Number.isFinite(at) ? Math.max(0, at - now.getTime()) : null
}

/**
 * A response is a block when Cloudflare says so (cf-mitigated: challenge), when it is a 403 or 429,
 * or when a 200/503 carries challenge markers. A plain 503 without markers is an outage (retried).
 */
export function detectBlock(page: BlockCheck, now: Date = new Date()): BlockInfo | null {
  const retryAfterMs = parseRetryAfter(page.headers.get('retry-after'), now)
  const mitigated = (page.headers.get('cf-mitigated') ?? '').toLowerCase()
  if (mitigated === 'challenge') return { reason: `HTTP ${page.status}, Cloudflare challenge (cf-mitigated)`, retryAfterMs }
  const marker = page.body ? CHALLENGE_MARKERS.find(([pattern]) => pattern.test(page.body)) : undefined
  if (marker) return { reason: `HTTP ${page.status}, ${marker[1]}`, retryAfterMs }
  if (page.status === 429) return { reason: 'HTTP 429, твърде много заявки', retryAfterMs }
  if (page.status === 403) return { reason: 'HTTP 403, достъпът е отказан', retryAfterMs }
  return null
}

export class BlockedBySite extends Error {
  constructor(
    readonly url: string,
    readonly info: BlockInfo,
  ) {
    super(`Блокиран от сайта: ${info.reason} (${url})`)
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

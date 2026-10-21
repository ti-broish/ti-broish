/**
 * Signed-upload failures in words (client-safe: no server imports). One place decides what is
 * worth retrying (Drive 429/5xx, D1 „Network connection lost“, a dropped connection) and how the
 * row reads in Bulgarian, so an admin never sees a bare „HTTPError“ again.
 */

/** Statuses worth another try: rate limit, gateway/timeouts and server errors. 0 = no response. */
export function isTransientStatus(status: number) {
  return status === 0 || status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

const TRANSIENT_TEXT = /network connection lost|connection (?:reset|closed|refused)|timed? ?out|timeout|overloaded|temporarily|try again|internal error|D1_ERROR.*(?:reset|storage|unavailable)|fetch failed|load failed|failed to fetch|networkerror/i

export function isTransientMessage(message: string) {
  return TRANSIENT_TEXT.test(message)
}

function driveStatusWords(status: number) {
  if (status === 429) return 'твърде много заявки към Drive'
  if (status === 401) return 'Google не прие токена'
  if (status === 403) return 'Drive отказа достъп (права или квота)'
  if (status === 404) return 'Drive не намира папката или файла'
  if (status === 413) return 'файлът е твърде голям за Drive'
  if (status >= 500) return 'временна грешка в Google Drive'
  return 'Drive отказа заявката'
}

export interface UploadFailure {
  message: string
  retryable: boolean
  /** HTTP status to answer the page with. */
  status: number
}

/** Server side: whatever the handler threw becomes a JSON-able, Bulgarian failure. */
export function describeUploadError(error: unknown): UploadFailure {
  const bag = (error && typeof error === 'object' ? error : {}) as { name?: unknown; status?: unknown; reason?: unknown; message?: unknown }
  const raw = typeof bag.message === 'string' ? bag.message : String(error ?? '')
  if (bag.name === 'DriveHttpError' && typeof bag.status === 'number') {
    const reason = typeof bag.reason === 'string' && bag.reason ? `, ${bag.reason}` : ''
    const retryable = isTransientStatus(bag.status)
    return {
      message: `Google Drive върна HTTP ${bag.status} (${driveStatusWords(bag.status)}${reason}).${retryable ? ' Временно е: опитай пак.' : ''}`,
      retryable,
      status: retryable ? 503 : 502,
    }
  }
  if (/D1_ERROR|D1 /.test(raw) || /network connection lost/i.test(raw)) {
    const retryable = isTransientMessage(raw)
    const short = raw.replace(/^Error:\s*/, '').split('\n')[0]!.slice(0, 140)
    return {
      message: retryable ? `Базата (D1) не отговори: ${short}. Временно е: опитай пак.` : `Грешка в базата (D1): ${short}`,
      retryable,
      status: retryable ? 503 : 500,
    }
  }
  const retryable = isTransientMessage(raw)
  const short = raw.split('\n')[0]!.slice(0, 160) || 'неизвестна грешка'
  return { message: retryable ? `${short}. Временно е: опитай пак.` : short, retryable, status: retryable ? 503 : 502 }
}

/** Client side: the cell text for a response that was not `{ ok: true }`. */
export function describeUploadResponse(status: number, statusText: string, body: unknown): { message: string; retryable: boolean } {
  const bag = (body && typeof body === 'object' ? body : {}) as { message?: unknown; retryable?: unknown }
  const serverMessage = typeof bag.message === 'string' ? bag.message.trim() : ''
  const explicit = typeof bag.retryable === 'boolean' ? bag.retryable : null
  const retryable = explicit ?? (isTransientStatus(status) || isTransientMessage(serverMessage))
  // h3/TanStack answer an uncaught throw with `{ message: "HTTPError" }`: useless on its own.
  const meaningful = serverMessage && !/^(?:HTTPError|Internal Server Error|Error)$/i.test(serverMessage)
  const head = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`
  if (meaningful) return { message: /HTTP \d{3}/.test(serverMessage) ? serverMessage : `${serverMessage} (${head})`, retryable }
  const words =
    status >= 500
      ? 'сървърна грешка'
      : status === 413
        ? 'файлът е твърде голям'
        : status === 401 || status === 403
          ? 'няма права или сесията изтече: презареди страницата'
          : status === 404
            ? 'няма такъв човек'
            : 'неуспешна заявка'
  return { message: `${head}: ${words}${retryable ? '. Временно е: опитай пак.' : '.'}`, retryable }
}

export const UPLOAD_RETRY_DELAYS_MS = [1000, 3000, 8000] as const

export type UploadAttempt =
  | { ok: true; body: Record<string, unknown>; attempts: number }
  | { ok: false; message: string; retryable: boolean; attempts: number }

/**
 * POST one PDF; retries transient failures with backoff (1 s, 3 s, 8 s). `ifMissing` makes the
 * server skip a person who already has a signed file (idempotent whole-ZIP re-upload).
 */
export async function postSignedPdf(
  input: { personId: string; bytes: Uint8Array; replace: boolean },
  deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; delays?: readonly number[] } = {},
): Promise<UploadAttempt> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const delays = deps.delays ?? UPLOAD_RETRY_DELAYS_MS
  const url = `/admin/palnomoshtni/upload?personId=${encodeURIComponent(input.personId)}${input.replace ? '' : '&ifMissing=1'}`
  let last: { message: string; retryable: boolean } = { message: 'неизвестна грешка', retryable: false }
  let tries = 0
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    tries = attempt + 1
    if (attempt > 0) await sleep(delays[attempt - 1]!)
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/pdf' },
        body: input.bytes as unknown as BodyInit,
        credentials: 'same-origin',
      })
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
      if (response.ok && body && body.ok === true) return { ok: true, body, attempts: attempt + 1 }
      last = describeUploadResponse(response.status, response.statusText, body)
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : 'няма връзка'
      last = { message: `Няма отговор от сървъра (${detail}). Временно е: опитай пак.`, retryable: true }
    }
    if (!last.retryable) break
  }
  return { ok: false, ...last, attempts: tries }
}

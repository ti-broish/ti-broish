import { describe, expect, it } from 'vitest'
import { DriveHttpError, driveErrorReason } from './designation-drive-core'
import { describeUploadError, describeUploadResponse, isTransientStatus, postSignedPdf } from './designation-upload-errors'

const pdf = new TextEncoder().encode('%PDF-1.4 x')
const noSleep = async () => {}

function json(body: unknown, status = 200, statusText = '') {
  return new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } })
}

describe('upload failures in words', () => {
  it('a dropped D1 connection (the 21.10 „HTTPError“) is retryable and says so in Bulgarian', () => {
    const failure = describeUploadError(new Error('D1_ERROR: Network connection lost.'))
    expect(failure.retryable).toBe(true)
    expect(failure.status).toBe(503)
    expect(failure.message).toContain('Базата (D1) не отговори')
    expect(failure.message).toContain('опитай пак')
  })

  it('Drive errors carry the HTTP status and Google reason', () => {
    const rate = describeUploadError(new DriveHttpError(429, 'rateLimitExceeded'))
    expect(rate).toMatchObject({ retryable: true, status: 503 })
    expect(rate.message).toBe('Google Drive върна HTTP 429 (твърде много заявки към Drive, rateLimitExceeded). Временно е: опитай пак.')
    const denied = describeUploadError(new DriveHttpError(403, 'insufficientFilePermissions'))
    expect(denied.retryable).toBe(false)
    expect(denied.message).toContain('HTTP 403')
    expect(denied.message).toContain('insufficientFilePermissions')
  })

  it('reads the reason out of a Google error body', () => {
    expect(driveErrorReason({ error: { code: 403, message: 'x', errors: [{ reason: 'storageQuotaExceeded' }] } })).toBe('storageQuotaExceeded')
    expect(driveErrorReason({ error: { message: 'Backend Error' } })).toBe('Backend Error')
    expect(driveErrorReason(null)).toBe('')
  })

  it('never shows a bare „HTTPError“: status and a short reason instead', () => {
    const result = describeUploadResponse(500, 'Internal Server Error', { status: 500, message: 'HTTPError' })
    expect(result.message).toBe('HTTP 500 Internal Server Error: сървърна грешка. Временно е: опитай пак.')
    expect(result.retryable).toBe(true)
    expect(describeUploadResponse(400, '', { ok: false, message: 'Файлът трябва да започва с %PDF-.' })).toEqual({
      message: 'Файлът трябва да започва с %PDF-. (HTTP 400)',
      retryable: false,
    })
  })

  it('knows which statuses are transient', () => {
    expect([0, 429, 500, 502, 503, 504].every(isTransientStatus)).toBe(true)
    expect([400, 401, 403, 404, 413].some(isTransientStatus)).toBe(false)
  })
})

describe('postSignedPdf', () => {
  it('retries transient failures with backoff and then succeeds', async () => {
    const urls: string[] = []
    const answers = [
      () => json({ status: 500, message: 'HTTPError' }, 500),
      () => {
        throw new TypeError('Failed to fetch')
      },
      () => json({ ok: true, url: 'u' }),
    ]
    const waits: number[] = []
    const result = await postSignedPdf(
      { personId: 'pp-1', bytes: pdf, replace: false },
      {
        fetchImpl: (async (url: string) => {
          urls.push(url)
          return answers[urls.length - 1]!()
        }) as unknown as typeof fetch,
        sleep: async (ms) => {
          waits.push(ms)
        },
      },
    )
    expect(result).toMatchObject({ ok: true, attempts: 3 })
    expect(waits).toEqual([1000, 3000])
    expect(urls[0]).toBe('/admin/palnomoshtni/upload?personId=pp-1&ifMissing=1')
  })

  it('does not retry a permanent failure and returns the reason', async () => {
    let calls = 0
    const result = await postSignedPdf(
      { personId: 's-1', bytes: pdf, replace: true },
      {
        fetchImpl: (async (url: string) => {
          calls += 1
          expect(url).not.toContain('ifMissing')
          return json({ ok: false, message: 'Човекът още няма номер.' }, 400)
        }) as unknown as typeof fetch,
        sleep: noSleep,
      },
    )
    expect(calls).toBe(1)
    expect(result).toEqual({ ok: false, message: 'Човекът още няма номер. (HTTP 400)', retryable: false, attempts: 1 })
  })

  it('gives up after the last backoff with a retryable reason (for „Опитай пак“)', async () => {
    let calls = 0
    const result = await postSignedPdf(
      { personId: 's-1', bytes: pdf, replace: false },
      {
        fetchImpl: (async () => {
          calls += 1
          return json({ ok: false, message: 'Google Drive върна HTTP 503 (временна грешка в Google Drive).', retryable: true }, 503)
        }) as unknown as typeof fetch,
        sleep: noSleep,
      },
    )
    expect(calls).toBe(4)
    expect(result).toMatchObject({ ok: false, retryable: true, attempts: 4 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { photoKey, servePhoto } from './proxy'

const ORIGIN = 'https://minio-origin.tibroish.bg'

function upstream(status: number, body: string | null, headers: Record<string, string> = {}) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status, headers }))
}

describe('photoKey', () => {
  it('accepts plain keys and nested keys', () => {
    expect(photoKey('/photos/01HABCDEF.jpg')).toBe('01HABCDEF.jpg')
    expect(photoKey('/photos/2026/10/a_b-c.png')).toBe('2026/10/a_b-c.png')
  })

  it('rejects traversal, encoding, empty keys and listings', () => {
    for (const path of [
      '/photos/',
      '/photos',
      '/photos/../admin/x',
      '/photos/a/../../b',
      '/photos/./a.jpg',
      '/photos/%2e%2e/a.jpg',
      '/photos/a%2Fb.jpg',
      '/photos/a//b.jpg',
      '/photos/dir/',
      '/photos/.hidden',
      '/photos/a\\b.jpg',
      '/photos/a b.jpg',
      '/code/a.jpg',
      `/photos/${'a'.repeat(513)}`,
    ]) {
      expect(photoKey(path), path).toBeNull()
    }
  })
})

describe('servePhoto', () => {
  it('streams the object from the photos bucket with cache headers', async () => {
    const fetchImpl = upstream(200, 'PNGDATA', {
      'content-type': 'image/png',
      'content-length': '7',
      etag: '"abc"',
      'last-modified': 'Mon, 18 May 2026 15:15:30 GMT',
      'x-amz-request-id': 'secret-ish',
      server: 'MinIO',
    })
    const res = await servePhoto(new Request('https://tibroish.bg/photos/01H.png'), ORIGIN, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0][0]).toBe(`${ORIGIN}/photos/01H.png`)
    expect(fetchImpl.mock.calls[0][1]?.method).toBe('GET')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('PNGDATA')
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-length')).toBe('7')
    expect(res.headers.get('etag')).toBe('"abc"')
    expect(res.headers.get('cache-control')).toContain('max-age=31536000')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-amz-request-id')).toBeNull()
    expect(res.headers.get('server')).toBeNull()
    expect(res.headers.get('content-disposition')).toBeNull()
  })

  it('answers HEAD without a body', async () => {
    const fetchImpl = upstream(200, null, { 'content-type': 'image/jpeg', 'content-length': '10' })
    const res = await servePhoto(new Request('https://tibroish.bg/photos/a.jpg', { method: 'HEAD' }), ORIGIN, fetchImpl)
    expect(fetchImpl.mock.calls[0][1]?.method).toBe('HEAD')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('10')
    expect(res.body).toBeNull()
  })

  it('forwards conditional and range headers', async () => {
    const fetchImpl = upstream(304, null, { etag: '"abc"' })
    const res = await servePhoto(
      new Request('https://tibroish.bg/photos/a.jpg', { headers: { 'if-none-match': '"abc"', range: 'bytes=0-1', cookie: 'x=1' } }),
      ORIGIN,
      fetchImpl,
    )
    const sent = new Headers(fetchImpl.mock.calls[0][1]?.headers)
    expect(sent.get('if-none-match')).toBe('"abc"')
    expect(sent.get('range')).toBe('bytes=0-1')
    expect(sent.get('cookie')).toBeNull()
    expect(res.status).toBe(304)
  })

  it('returns 404 for a missing or forbidden object', async () => {
    for (const status of [404, 403]) {
      const res = await servePhoto(new Request('https://tibroish.bg/photos/missing.jpg'), ORIGIN, upstream(status, '<Error/>', { 'content-type': 'application/xml' }))
      expect(res.status).toBe(404)
      expect(await res.text()).not.toContain('Error')
    }
  })

  it('never calls storage for a rejected path', async () => {
    const fetchImpl = upstream(200, 'x')
    for (const url of ['https://tibroish.bg/photos/', 'https://tibroish.bg/photos/a/../../results/x', 'https://tibroish.bg/photos/%2e%2e/x']) {
      const res = await servePhoto(new Request(url), ORIGIN, fetchImpl)
      expect(res.status).toBe(404)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects other methods', async () => {
    const fetchImpl = upstream(200, 'x')
    const res = await servePhoto(new Request('https://tibroish.bg/photos/a.jpg', { method: 'PUT', body: 'x' }), ORIGIN, fetchImpl)
    expect(res.status).toBe(405)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps storage failures to 502 and missing config to 503', async () => {
    expect((await servePhoto(new Request('https://tibroish.bg/photos/a.jpg'), ORIGIN, upstream(500, 'boom'))).status).toBe(502)
    const failing = vi.fn(async () => {
      throw new Error('connect failed')
    })
    expect((await servePhoto(new Request('https://tibroish.bg/photos/a.jpg'), ORIGIN, failing)).status).toBe(502)
    expect((await servePhoto(new Request('https://tibroish.bg/photos/a.jpg'), undefined, upstream(200, 'x'))).status).toBe(503)
  })

  it('serves non-image objects as downloads, never as pages', async () => {
    const res = await servePhoto(new Request('https://tibroish.bg/photos/a.html'), ORIGIN, upstream(200, '<script>', { 'content-type': 'text/html' }))
    expect(res.headers.get('content-disposition')).toBe('attachment')
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
  })
})

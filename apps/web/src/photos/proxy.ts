// Public protocol and signal photos at /photos/<key>.
// The API stores links as MINIO_URL/photos/<key> with MINIO_URL=https://tibroish.bg,
// so this keeps those links working. The old nginx on tibroish.bg proxied /photos
// to MinIO without auth; this does the same, for single objects in the photos bucket only.

export const PHOTOS_BUCKET = 'photos'

// One year. Keys are generated once per upload and never rewritten.
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/

const PASSED_HEADERS = [
  'content-type',
  'content-length',
  'etag',
  'last-modified',
  'accept-ranges',
  'content-range',
] as const

const FORWARDED_REQUEST_HEADERS = ['range', 'if-none-match', 'if-modified-since'] as const

/**
 * Returns the object key for a /photos/<key> path, or null when the key is not allowed.
 * Only plain path segments are allowed: no percent-encoding, no `.` or `..`,
 * no empty segments and no trailing slash, so nothing can reach another bucket or a listing.
 */
export function photoKey(pathname: string): string | null {
  const prefix = `/${PHOTOS_BUCKET}/`
  if (!pathname.startsWith(prefix)) return null
  const key = pathname.slice(prefix.length)
  if (key.length === 0 || key.length > 512) return null
  const segments = key.split('/')
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) return null
  }
  return key
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=60' },
  })
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function servePhoto(
  request: Request,
  origin: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const key = photoKey(new URL(request.url).pathname)
  if (key === null) return notFound()
  if (!origin) {
    return new Response('Photo storage is not configured', { status: 503 })
  }

  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  let upstream: Response
  try {
    upstream = await fetchImpl(`${origin.replace(/\/+$/, '')}/${PHOTOS_BUCKET}/${key}`, {
      method: request.method,
      headers,
      redirect: 'manual',
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 86400, '404': 60, '500-599': 0 } },
    } as RequestInit)
  } catch {
    return new Response('Photo storage is unreachable', { status: 502 })
  }

  // MinIO answers 404 NoSuchKey for a missing object and 403 AccessDenied for paths the
  // anonymous policy does not cover. Neither should leak storage details.
  if (upstream.status === 404 || upstream.status === 403) return notFound()
  if (upstream.status !== 200 && upstream.status !== 206 && upstream.status !== 304) {
    return new Response('Photo storage error', { status: 502 })
  }

  const out = new Headers()
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) out.set(name, value)
  }
  out.set('cache-control', CACHE_CONTROL)
  out.set('x-content-type-options', 'nosniff')
  // Photos are served from the main site origin, so never let a stored file run as a page.
  out.set('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
  const type = out.get('content-type') ?? ''
  if (!type.startsWith('image/')) out.set('content-disposition', 'attachment')

  const body = request.method === 'HEAD' || upstream.status === 304 ? null : upstream.body
  return new Response(body, { status: upstream.status, headers: out })
}

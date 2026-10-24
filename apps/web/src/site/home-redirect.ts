/**
 * Election days: the home page sends people straight to the violation form. A temporary 302, so it is
 * easy to undo after the elections (drop the call in src/server.ts and the beforeLoad in routes/index.tsx).
 * The query string is kept: /signal reads ?name=, ?email=, ?oblast= and ?origin= (origin=iaz co-brands it).
 */
export const HOME_REDIRECT_TARGET = '/signal'

/** The Location for `/` (with its query string), or null for every other path. */
export function homeRedirectLocation(url: URL): string | null {
  if (url.pathname !== '/') return null
  return `${HOME_REDIRECT_TARGET}${url.search}`
}

export function homeRedirect(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const location = homeRedirectLocation(new URL(request.url))
  if (!location) return null
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } })
}

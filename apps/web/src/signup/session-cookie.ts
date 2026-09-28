/** Secure cookies are dropped on http://127.0.0.1, which is the local app. HTTPS stays secure. */
export function sessionCookieSecure(host: string | null | undefined) {
  let bare = (host ?? '').trim()
  if (bare.startsWith('[')) {
    const end = bare.indexOf(']')
    bare = end === -1 ? bare : bare.slice(1, end)
  } else {
    const colon = bare.lastIndexOf(':')
    if (colon > 0 && bare.indexOf(':') === colon && /^\d+$/.test(bare.slice(colon + 1))) bare = bare.slice(0, colon)
  }
  if (!bare) return true
  return bare !== 'localhost' && bare !== '127.0.0.1' && bare !== '::1'
}

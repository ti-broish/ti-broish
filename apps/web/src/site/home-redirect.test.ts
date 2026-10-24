import { describe, expect, it } from 'vitest'
import { homeRedirect, homeRedirectLocation } from './home-redirect'

describe('home redirect', () => {
  it('sends / to /signal with a temporary 302 and keeps the query string', () => {
    const response = homeRedirect(new Request('https://tibroish.bg/?origin=iaz&name=%D0%98%D0%B2%D0%B0%D0%BD&oblast=23'))
    expect(response?.status).toBe(302)
    expect(response?.headers.get('Location')).toBe('/signal?origin=iaz&name=%D0%98%D0%B2%D0%B0%D0%BD&oblast=23')
  })

  it('sends a bare / to /signal', () => {
    expect(homeRedirectLocation(new URL('https://tibroish.bg/'))).toBe('/signal')
    expect(homeRedirect(new Request('https://tibroish.bg/', { method: 'HEAD' }))?.headers.get('Location')).toBe('/signal')
  })

  it('leaves every other route alone', () => {
    for (const path of ['/signal', '/signup?step=contact', '/vhod', '/profil', '/admin', '/instructions', '/znachka', '/potvardi?companion=x']) {
      expect(homeRedirect(new Request(`https://tibroish.bg${path}`))).toBeNull()
    }
  })

  it('does not redirect a POST to /', () => {
    expect(homeRedirect(new Request('https://tibroish.bg/', { method: 'POST' }))).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { PRODUCTION_API, STAGING_API, buildApiBase, resolveApiBase } from './api-base'

describe('buildApiBase', () => {
  it('always gives a production build the production API', () => {
    expect(buildApiBase({ command: 'build', cloudflareEnv: 'production' })).toBe(PRODUCTION_API)
    expect(buildApiBase({ command: 'build', cloudflareEnv: 'production', override: STAGING_API })).toBe(PRODUCTION_API)
  })

  it('gives the staging build the staging API', () => {
    expect(buildApiBase({ command: 'build' })).toBe(STAGING_API)
    expect(buildApiBase({ command: 'build', cloudflareEnv: '' })).toBe(STAGING_API)
  })

  it('keeps the production API for vite dev, which the e2e specs mock', () => {
    expect(buildApiBase({ command: 'serve' })).toBe(PRODUCTION_API)
  })

  it('takes an explicit override outside production', () => {
    expect(buildApiBase({ command: 'serve', override: 'https://d1tapi.tibroish.bg/' })).toBe(STAGING_API)
  })
})

describe('resolveApiBase', () => {
  it('never uses another API on tibroish.bg', () => {
    expect(resolveApiBase(STAGING_API, 'tibroish.bg')).toBe(PRODUCTION_API)
    expect(resolveApiBase(STAGING_API, 'www.tibroish.bg')).toBe(PRODUCTION_API)
  })

  it('uses the build value on staging hosts', () => {
    expect(resolveApiBase(STAGING_API, 'd1t.tibroish.bg')).toBe(STAGING_API)
    expect(resolveApiBase(STAGING_API, 'ti-broish-web-staging.dabulgaria-bg.workers.dev')).toBe(STAGING_API)
  })

  it('falls back to production for a missing or malformed value', () => {
    expect(resolveApiBase(undefined)).toBe(PRODUCTION_API)
    expect(resolveApiBase('')).toBe(PRODUCTION_API)
    expect(resolveApiBase('http://evil.example')).toBe(PRODUCTION_API)
    expect(resolveApiBase('https://d1tapi.tibroish.bg/path')).toBe(PRODUCTION_API)
  })
})

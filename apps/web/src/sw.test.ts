import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

interface FetchEventLike {
  request: { method: string; url: string }
  respondWith: (value: unknown) => void
}

function installWorker() {
  const listeners = new Map<string, (event: FetchEventLike) => void>()
  const previousSelf = globalThis.self
  const previousFetch = globalThis.fetch
  globalThis.self = {
    skipWaiting() {},
    clients: { claim: () => Promise.resolve() },
    addEventListener(type: string, listener: (event: FetchEventLike) => void) {
      listeners.set(type, listener)
    },
  } as unknown as typeof globalThis.self
  globalThis.fetch = (() => Promise.resolve(new Response('ok'))) as typeof fetch
  try {
    // Classic worker script. `self` and `fetch` resolve on the global object.
    eval(source)
  } finally {
    globalThis.self = previousSelf
  }
  const onFetch = listeners.get('fetch')
  if (!onFetch) throw new Error('missing fetch listener')
  return {
    onFetch,
    restore() {
      globalThis.fetch = previousFetch
    },
  }
}

describe('service worker', () => {
  const worker = installWorker()
  afterAll(() => worker.restore())

  function intercepts(method: string, url: string) {
    const calls: unknown[] = []
    worker.onFetch({
      request: { method, url },
      respondWith: (value) => calls.push(value),
    })
    return calls.length
  }

  it('does not intercept the admin roster POST, so the started list can settle', () => {
    expect(intercepts('POST', 'https://tibroish.bg/_serverFn/roster')).toBe(0)
  })

  it('does not intercept server functions even when they are GET', () => {
    expect(intercepts('GET', 'https://tibroish.bg/_serverFn/roster')).toBe(0)
  })

  it('still passes ordinary GET navigation through', () => {
    expect(intercepts('GET', 'https://tibroish.bg/znachka')).toBe(1)
  })
})

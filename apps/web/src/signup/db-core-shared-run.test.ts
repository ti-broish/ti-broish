import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A D1 stand-in. `hangRun` makes every run() never settle; `hangSweep` makes only the withdrawn-seat
 * sweep's SELECT never settle. That is what a request sees when it awaits a bootstrap started by
 * another request that the runtime has since canceled: the D1 calls and the timers of the canceled
 * request are gone, so the shared promise never settles on its own.
 */
const state = { hangRun: false, hangSweep: false }
function statement(sql: string): Record<string, unknown> {
  const self: Record<string, unknown> = {
    bind: () => self,
    run: () => (state.hangRun ? new Promise(() => {}) : Promise.resolve({ meta: { changes: 0 } })),
    first: () => Promise.resolve(null),
    all: () => (state.hangSweep && /FROM signups WHERE/.test(sql) && /LIMIT \?/.test(sql) ? new Promise(() => {}) : Promise.resolve({ results: [] })),
  }
  return self
}
const fakeDb = { prepare: (sql: string) => statement(sql), batch: () => Promise.resolve([]) }

vi.mock('cloudflare:workers', () => ({ env: { DB: fakeDb } }))

/**
 * Starts a request whose timers never fire, as if the runtime canceled it mid-bootstrap: every
 * timer it sets until its D1 work is stuck (microtasks drained) is dropped.
 */
async function canceledRequest(start: () => Promise<unknown>) {
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout
  const settled = { done: false }
  try {
    start().then(
      () => (settled.done = true),
      () => (settled.done = true),
    )
    for (let i = 0; i < 500; i += 1) await Promise.resolve()
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  return settled
}

describe('signupDatabase with a bootstrap owned by a canceled request', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    state.hangRun = false
    state.hangSweep = false
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('a later request stops waiting on the dead shared run and bootstraps on its own', async () => {
    const { signupDatabase, SCHEMA_DEADLINE_MS } = await import('./db-core')
    state.hangRun = true
    const first = await canceledRequest(() => signupDatabase())

    const second = signupDatabase()
    state.hangRun = false
    await vi.advanceTimersByTimeAsync(SCHEMA_DEADLINE_MS + 1)
    await expect(second).resolves.toBe(fakeDb)
    // The canceled request's own run never settles; nobody waits on it any more.
    expect(first.done).toBe(false)

    // The fresh run is now the cached one: a third request is answered without a wait.
    const third = signupDatabase()
    await vi.advanceTimersByTimeAsync(1)
    await expect(third).resolves.toBe(fakeDb)
  })

  it('a withdrawn-seat sweep stuck in a canceled request does not block later bootstraps', async () => {
    const { signupDatabase, SCHEMA_DEADLINE_MS, WITHDRAWN_SWEEP_DEADLINE_MS } = await import('./db-core')
    state.hangSweep = true
    await canceledRequest(() => signupDatabase())

    const second = signupDatabase()
    state.hangSweep = false
    await vi.advanceTimersByTimeAsync(SCHEMA_DEADLINE_MS + WITHDRAWN_SWEEP_DEADLINE_MS + 2)
    await expect(second).resolves.toBe(fakeDb)
  })

  it('the request that starts the run still fails after the deadline when D1 never answers', async () => {
    const { signupDatabase, SCHEMA_DEADLINE_MS } = await import('./db-core')
    state.hangRun = true
    const first = signupDatabase().then(() => 'resolved', (error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(SCHEMA_DEADLINE_MS + 1)
    expect(await first).toMatch(/did not finish/)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A D1 stand-in: every call settles at once, except while `hang` is on, when run() never settles. */
const state = { hang: false, runs: 0 }
function statement(): Record<string, unknown> {
  const self: Record<string, unknown> = {
    bind: () => self,
    run: () => {
      state.runs += 1
      return state.hang ? new Promise(() => {}) : Promise.resolve({ meta: { changes: 0 } })
    },
    first: () => Promise.resolve(null),
    all: () => Promise.resolve({ results: [] }),
  }
  return self
}
const fakeDb = { prepare: () => statement(), batch: () => Promise.resolve([]) }

vi.mock('cloudflare:workers', () => ({ env: { DB: fakeDb } }))

describe('signupDatabase bootstrap deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('a D1 call that never settles fails the request after the deadline, and the next request recovers', async () => {
    const { signupDatabase, SCHEMA_DEADLINE_MS } = await import('./db-core')
    state.hang = true
    const first = signupDatabase()
    const outcome = first.then(() => 'resolved', (error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(SCHEMA_DEADLINE_MS + 1)
    expect(await outcome).toMatch(/did not finish/)

    // Before the fix the dead promise stayed cached and this request hung forever too.
    state.hang = false
    const second = signupDatabase()
    await vi.advanceTimersByTimeAsync(1)
    await expect(second).resolves.toBe(fakeDb)
  })

  it('withDeadline passes a settled result through', async () => {
    const { withDeadline } = await import('./db-core')
    await expect(withDeadline(Promise.resolve(7), 1000, 'x')).resolves.toBe(7)
  })
})

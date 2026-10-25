// Server functions for the unit pages and the signal page: run in the worker during SSR and over RPC on navigation.
import { createServerFn } from '@tanstack/react-start'
import type { ElectionMeta, PublicViolation, ResultsUnit } from './results'

async function waitUntil() {
  const workers = (await import('cloudflare:workers')) as { waitUntil?: (promise: Promise<unknown>) => void }
  return workers.waitUntil ?? (() => undefined)
}

export interface UnitPayload {
  meta: ElectionMeta | null
  unit: ResultsUnit | null
  /** The API did not answer (as opposed to a unit that does not exist). */
  error: boolean
}

export const loadResultsUnit = createServerFn({ method: 'GET' })
  .validator((unit: unknown) => (typeof unit === 'string' ? unit : 'index'))
  .handler(async ({ data }): Promise<UnitPayload> => {
    const [{ loadMeta, loadUnit }, wait] = await Promise.all([import('./results.server'), waitUntil()])
    let error = false
    const [meta, unit] = await Promise.all([
      loadMeta(wait).catch(() => null),
      loadUnit(data, wait).catch(() => {
        error = true
        return null
      }),
    ])
    return { meta, unit, error }
  })

export const loadPublicViolation = createServerFn({ method: 'GET' })
  .validator((id: unknown) => (typeof id === 'string' ? id : ''))
  .handler(async ({ data }): Promise<PublicViolation | null> => {
    const [{ loadViolation }, wait] = await Promise.all([import('./results.server'), waitUntil()])
    return loadViolation(data, wait).catch(() => null)
  })

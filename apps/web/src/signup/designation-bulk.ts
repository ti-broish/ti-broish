import { createServerFn } from '@tanstack/react-start'
import { personIdOk } from './designation-files'

export const adminDesignationStatus = createServerFn({ method: 'POST' })
  .validator((input: { mir?: string; q?: string } = {}) => ({
    mir: (input.mir ?? '').trim().slice(0, 8),
    q: (input.q ?? '').trim().slice(0, 120),
  }))
  .handler(async ({ data }) => {
    const { handleDesignationStatus } = await import('./designation-bulk.server')
    return handleDesignationStatus(data)
  })

export const adminDesignationNumber = createServerFn({ method: 'POST' }).handler(async () => {
  const { handleDesignationNumber } = await import('./designation-bulk.server')
  return handleDesignationNumber()
})

export const adminDesignationHealth = createServerFn({ method: 'POST' }).handler(async () => {
  const { handleDesignationHealth } = await import('./designation-bulk.server')
  return handleDesignationHealth()
})

export const adminDesignationSyncBrevo = createServerFn({ method: 'POST' })
  .validator((input: { personIds: string[] }) => ({
    personIds: [...new Set((input.personIds ?? []).filter(personIdOk))].slice(0, 500),
  }))
  .handler(async ({ data }) => {
    const { handleDesignationSyncBrevo } = await import('./designation-bulk.server')
    return handleDesignationSyncBrevo(data)
  })

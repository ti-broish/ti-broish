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
  .validator((input: { personIds?: string[]; allSigned?: boolean; offset?: number }) => ({
    personIds: [...new Set((input.personIds ?? []).filter(personIdOk))].slice(0, 300),
    allSigned: input.allSigned === true,
    offset: Number.isInteger(input.offset) && (input.offset ?? 0) > 0 ? Number(input.offset) : 0,
  }))
  .handler(async ({ data }) => {
    const { handleDesignationSyncBrevo } = await import('./designation-bulk.server')
    return handleDesignationSyncBrevo(data)
  })

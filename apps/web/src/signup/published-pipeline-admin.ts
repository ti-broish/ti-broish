import { createServerFn } from '@tanstack/react-start'

export const adminAdvancePublished = createServerFn({ method: 'POST' }).handler(async () => {
  const { handleAdvancePublished } = await import('./published-pipeline')
  return handleAdvancePublished()
})

export const adminPipelineCounts = createServerFn({ method: 'POST' }).handler(async () => {
  const { handlePipelineCounts } = await import('./published-pipeline')
  return handlePipelineCounts()
})

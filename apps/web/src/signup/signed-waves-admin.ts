import { createServerFn } from '@tanstack/react-start'

/** Waves of signed пълномощни with counts per РИК (no names, no ЕГН). */
export const adminSignedWaves = createServerFn({ method: 'POST' }).handler(async () => {
  const { handleSignedWaves } = await import('./signed-waves.server')
  return handleSignedWaves()
})

/** „Изпратена на РИК“: close the open wave of one PDF date (YYYY-MM-DD). */
export const adminCloseSigningWave = createServerFn({ method: 'POST' })
  .validator((input: { issueDate: string }) => ({ issueDate: String(input?.issueDate ?? '').trim() }))
  .handler(async ({ data }) => {
    const { handleCloseSigningWave } = await import('./signed-waves.server')
    return handleCloseSigningWave(data.issueDate)
  })

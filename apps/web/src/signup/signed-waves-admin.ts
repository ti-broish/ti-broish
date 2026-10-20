import { createServerFn } from '@tanstack/react-start'

/** Waves of signed пълномощни with counts per РИК (no names, no ЕГН). */
export const adminSignedWaves = createServerFn({ method: 'POST' }).handler(async () => {
  const { handleSignedWaves } = await import('./signed-waves.server')
  return handleSignedWaves()
})

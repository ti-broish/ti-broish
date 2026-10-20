import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/palnomoshtni_/podpisani')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { serveSignedWaveZip } = await import('../../signup/signed-waves.server')
        return serveSignedWaveZip(request)
      },
    },
  },
})

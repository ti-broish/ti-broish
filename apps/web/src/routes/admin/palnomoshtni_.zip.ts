import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/palnomoshtni_/zip')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { serveDesignationZip } = await import('../../signup/designation-zip')
        return serveDesignationZip(request)
      },
    },
  },
})

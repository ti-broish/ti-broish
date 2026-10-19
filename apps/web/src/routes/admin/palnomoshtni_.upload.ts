import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/palnomoshtni_/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { serveDesignationUpload } = await import('../../signup/designation-upload')
        return serveDesignationUpload(request)
      },
    },
  },
})

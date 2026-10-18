import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/signups_/$personId_/palnomoshtno.pdf')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { serveDesignationPdf } = await import('../../signup/designation-admin')
        return serveDesignationPdf(params.personId)
      },
    },
  },
})

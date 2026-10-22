import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/profil_/palnomoshtno.pdf')({
  server: {
    handlers: {
      GET: async () => {
        const { serveOwnDesignationPdf } = await import('../signup/own-designation.server')
        return serveOwnDesignationPdf()
      },
    },
  },
})

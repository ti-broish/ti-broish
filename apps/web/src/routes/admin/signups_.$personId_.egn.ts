import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/signups_/$personId_/egn')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { serveEgnReveal } = await import('../../signup/egn-reveal-admin')
        return serveEgnReveal(request, params.personId)
      },
    },
  },
})

import { createFileRoute } from '@tanstack/react-router'

// Published signals for the home page map and feed. See src/home/violations.server.ts.
async function handle({ request }: { request: Request }) {
  const [workers, { handleViolations }] = await Promise.all([import('cloudflare:workers'), import('../home/violations.server')])
  const waitUntil = (workers as { waitUntil?: (promise: Promise<unknown>) => void }).waitUntil ?? (() => undefined)
  return handleViolations(request, workers.env as { ALLOW_DEMO_DATA?: string }, waitUntil)
}

export const Route = createFileRoute('/api/violations')({
  server: {
    handlers: { GET: handle },
  },
})

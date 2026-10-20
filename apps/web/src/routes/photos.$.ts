import { createFileRoute } from '@tanstack/react-router'

async function handle({ request }: { request: Request }) {
  const [{ env }, { servePhoto }] = await Promise.all([
    import('cloudflare:workers'),
    import('../photos/proxy'),
  ])
  return servePhoto(request, (env as { PHOTOS_ORIGIN?: string }).PHOTOS_ORIGIN)
}

export const Route = createFileRoute('/photos/$')({
  server: {
    handlers: {
      GET: handle,
      HEAD: handle,
      // Everything else gets 405 from servePhoto instead of the HTML app.
      ANY: handle,
    },
  },
})

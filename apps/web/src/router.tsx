import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { NotFoundPage, RouteErrorPage } from './components/RouteFallback'
import { routeTree } from './routeTree.gen'
import { installChunkReload } from './components/chunk-reload'

export function getRouter() {
  // A tab left on an older build: a missing route chunk reloads the page once (chunk-reload.ts).
  installChunkReload()
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: RouteErrorPage,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

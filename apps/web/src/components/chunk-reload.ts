/**
 * After a deploy, an open tab still runs the old build and asks for route chunks that no longer exist
 * (/assets/access-Luld7l_k.js → 404), so the admin showed „Нещо се обърка“. On a chunk-load failure the
 * client reloads the page once to pick up the new build. A sessionStorage stamp stops a loop: no second
 * reload within RELOAD_GUARD_MS.
 */
export const CHUNK_RELOAD_KEY = 'tb-chunk-reload-at'
export const RELOAD_GUARD_MS = 60_000

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:CSS )?chunk [\w-]+ failed|ChunkLoadError/i

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'string') return CHUNK_ERROR.test(error)
  if (typeof error === 'object') {
    const record = error as { name?: unknown; message?: unknown; cause?: unknown }
    if (record.name === 'ChunkLoadError') return true
    if (typeof record.message === 'string' && CHUNK_ERROR.test(record.message)) return true
    if (record.cause && record.cause !== error) return isChunkLoadError(record.cause)
  }
  return false
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Reloads once (returns true), or returns false when a reload already happened within the guard window. */
export function reloadOnceForChunkError(storage: StorageLike | null, reload: () => void, now = Date.now()) {
  try {
    const last = Number(storage?.getItem(CHUNK_RELOAD_KEY) ?? 0)
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GUARD_MS) return false
    storage?.setItem(CHUNK_RELOAD_KEY, String(now))
  } catch {
    // No sessionStorage (private mode): without a guard, do not reload at all, so it cannot loop.
    return false
  }
  reload()
  return true
}

function sessionStore(win: Window): StorageLike | null {
  try {
    return win.sessionStorage
  } catch {
    return null
  }
}

let installed = false

/** Browser only: Vite's preload error and any unhandled chunk-load rejection trigger the one-time reload. */
export function installChunkReload(win: Window | undefined = typeof window === 'undefined' ? undefined : window) {
  if (!win || installed) return
  installed = true
  const reload = () => win.location.reload()
  win.addEventListener('vite:preloadError', (event) => {
    if (reloadOnceForChunkError(sessionStore(win), reload)) event.preventDefault()
  })
  win.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError((event as PromiseRejectionEvent).reason)) reloadOnceForChunkError(sessionStore(win), reload)
  })
}

/** For the route error boundary: a chunk error reloads once; returns whether it did. */
export function reloadIfChunkError(error: unknown, win: Window | undefined = typeof window === 'undefined' ? undefined : window) {
  if (!win || !isChunkLoadError(error)) return false
  return reloadOnceForChunkError(sessionStore(win), () => win.location.reload())
}

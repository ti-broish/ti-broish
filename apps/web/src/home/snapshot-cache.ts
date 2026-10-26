// A short-lived copy of an API answer per colo: isolate memory + the Cache API, refreshed in the background
// while a stale copy is served. Used by /api/violations (violations.server.ts), the results pages
// (results.server.ts) and the abroad section list (src/signup/abroad-sections.ts). No server-only imports,
// so modules that the admin route files also reach can use it.

/** Serve without refetching for this long (the feed default). */
const FRESH_MS = 45_000
/** Past FRESH_MS, serve the old copy while one refresh runs; past this, wait for the refresh. */
const STALE_MS = 10 * 60_000

/** Anything cached here carries the time it was fetched. */
export type Cached = { fetchedAt: number }

const memory = new Map<string, Cached>()
const inflight = new Map<string, Promise<Cached>>()

function edgeCache(): Cache | null {
  try {
    return typeof caches === 'undefined' ? null : (caches as unknown as { default: Cache }).default
  } catch {
    return null
  }
}

async function readCached<T extends Cached>(key: string): Promise<T | null> {
  const hit = memory.get(key) as T | undefined
  if (hit) return hit
  const cache = edgeCache()
  if (!cache) return null
  try {
    const response = await cache.match(key)
    if (!response) return null
    const snapshot = (await response.json()) as T
    memory.set(key, snapshot)
    return snapshot
  } catch {
    return null
  }
}

async function writeCached(key: string, snapshot: Cached, staleMs = STALE_MS) {
  memory.set(key, snapshot)
  const cache = edgeCache()
  if (!cache) return
  try {
    await cache.put(
      key,
      new Response(JSON.stringify(snapshot), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.round(staleMs / 1000)}` },
      }),
    )
  } catch {
    // Cache API is a no-op on workers.dev; isolate memory still helps.
  }
}

function refresh<T extends Cached>(key: string, load: () => Promise<T>, staleMs = STALE_MS): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running
  const next = load()
    .then(async (snapshot) => {
      await writeCached(key, snapshot, staleMs)
      return snapshot
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, next)
  return next
}

export async function cachedSnapshot<T extends Cached>(
  key: string,
  load: () => Promise<T>,
  waitUntil: (promise: Promise<unknown>) => void,
  now = Date.now(),
  ttl: { freshMs: number; staleMs: number } = { freshMs: FRESH_MS, staleMs: STALE_MS },
): Promise<T> {
  const cached = await readCached<T>(key)
  if (cached) {
    const age = now - cached.fetchedAt
    if (age < ttl.freshMs) return cached
    if (age < ttl.staleMs) {
      waitUntil(refresh(key, load, ttl.staleMs).catch(() => undefined))
      return cached
    }
  }
  return refresh(key, load, ttl.staleMs)
}

/** For tests. */
export function clearSnapshotCache() {
  memory.clear()
  inflight.clear()
}

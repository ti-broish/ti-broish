// /api/violations: published signals for the home page, fetched by the worker from api.tibroish.bg
// (d1tapi.tibroish.bg on staging, src/signup/api-base.ts).
// The old API has no cache and no rate limit, and its CORS list has no preview hosts, so the browser
// never calls it for the feed. Every colo keeps a short-lived copy (isolate memory + Cache API) and
// refreshes it in the background, so the API sees at most a few requests a minute per colo.
import { tibroishApi } from '../signup/api-base'
import { demoItems } from './demo'
import { cachedSnapshot, clearSnapshotCache } from './snapshot-cache'
import {
  FEED_PAGE_SIZE,
  countItems,
  inSegment,
  isProductionHost,
  toFeedItem,
  validAfter,
  validSegment,
  type ApiViolation,
  type Counts,
  type FeedItem,
} from './violations'

export { cachedSnapshot, type Cached } from './snapshot-cache'

export const UPSTREAM = tibroishApi()

/** The map counts at most this many pages of the full feed (50 each) per refresh. */
export const MAX_COUNT_PAGES = 20

export interface Snapshot {
  items: FeedItem[]
  counts: Counts | null
  more: boolean
  capped?: boolean
  fetchedAt: number
  demo?: boolean
}

type Fetcher = (url: string) => Promise<Response>
type Env = { ALLOW_DEMO_DATA?: string }


async function getPage(fetcher: Fetcher, path: string): Promise<ApiViolation[]> {
  const response = await fetcher(`${UPSTREAM}${path}`)
  if (!response.ok) throw new Error(`API ${response.status} for ${path}`)
  const data = (await response.json()) as unknown
  if (!Array.isArray(data)) throw new Error(`API returned no list for ${path}`)
  return data as ApiViolation[]
}

/** The first page plus counts over up to MAX_COUNT_PAGES pages of the full feed. */
export async function loadOverview(fetcher: Fetcher, maxPages = MAX_COUNT_PAGES): Promise<Snapshot> {
  const first = (await getPage(fetcher, '/violations/feed')).map(toFeedItem)
  const all = [...first]
  let page = first
  let pages = 1
  while (page.length >= FEED_PAGE_SIZE && pages < maxPages) {
    page = (await getPage(fetcher, `/violations/feed?after=${encodeURIComponent(page[page.length - 1].id)}`)).map(toFeedItem)
    all.push(...page)
    pages += 1
  }
  return {
    items: first,
    counts: countItems(all),
    more: first.length >= FEED_PAGE_SIZE,
    capped: page.length >= FEED_PAGE_SIZE && pages >= maxPages,
    fetchedAt: Date.now(),
  }
}

export async function loadList(fetcher: Fetcher, path: string, paged: boolean): Promise<Snapshot> {
  const items = (await getPage(fetcher, path)).map(toFeedItem)
  return { items, counts: null, more: paged && items.length >= FEED_PAGE_SIZE, fetchedAt: Date.now() }
}

export function demoAllowed(env: Env, url: URL) {
  return env.ALLOW_DEMO_DATA === '1' && !isProductionHost(url.hostname)
}

function json(body: unknown, status = 200, maxAge = 30) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? `public, max-age=${maxAge}` : 'no-store',
    },
  })
}

export async function handleViolations(
  request: Request,
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
  fetcher: Fetcher = (url) => fetch(url, { headers: { accept: 'application/json' } }),
): Promise<Response> {
  const url = new URL(request.url)
  const segment = url.searchParams.get('segment') ?? ''
  const after = url.searchParams.get('after') ?? ''
  if (segment && !validSegment(segment)) return json({ error: 'segment' }, 400)
  if (after && !validAfter(after)) return json({ error: 'after' }, 400)

  // ?demo=1 where sample data is not allowed (production) is ignored: real signals, never fake ones.
  if (url.searchParams.get('demo') === '1' && demoAllowed(env, url)) {
    const items = demoItems()
    const listed = segment ? items.filter((item) => inSegment(item, segment)) : items
    const snapshot: Snapshot = {
      items: after ? [] : listed,
      counts: segment || after ? null : countItems(items),
      more: false,
      fetchedAt: Date.now(),
      demo: true,
    }
    return json(snapshot, 200, 0)
  }

  try {
    let snapshot: Snapshot
    if (segment) {
      snapshot = await cachedSnapshot(`${UPSTREAM}/violations/feed/${segment}`, () => loadList(fetcher, `/violations/feed/${segment}`, false), waitUntil)
    } else if (after) {
      const path = `/violations/feed?after=${after}`
      snapshot = await cachedSnapshot(`${UPSTREAM}${path}`, () => loadList(fetcher, path, true), waitUntil)
    } else {
      snapshot = await cachedSnapshot(`${UPSTREAM}/violations/overview`, () => loadOverview(fetcher), waitUntil)
    }
    return json(snapshot)
  } catch {
    return json({ error: 'upstream' }, 502)
  }
}

/** For tests. */
export function clearViolationsCache() {
  clearSnapshotCache()
}

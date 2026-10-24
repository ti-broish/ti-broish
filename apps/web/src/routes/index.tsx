import { Link, createFileRoute, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ViolationsMap } from '../components/ViolationsMap'
import { regionName } from '../home/regions'
import { inSegment, type Counts, type FeedItem } from '../home/violations'
import { useRegistration } from '../signup/use-registration'

// Home: the map of published signals by МИР and the feed, from /api/violations (worker-cached).
// ?origin=iaz and the other /signal parameters are passed on to „Подай сигнал“.
// ?demo=1 shows clearly fake samples; the worker refuses it in production (src/home/violations.server.ts).
type HomeSearch = { demo?: 1 }

export const Route = createFileRoute('/')({
  // Only ?demo is read here. The rest of the query (origin, name, email, oblast) is left as typed and
  // handed to /signal unchanged, so the router does not rewrite the address (it would quote oblast=23).
  validateSearch: (search: Record<string, unknown>): HomeSearch => (search.demo === 1 || search.demo === '1' ? { demo: 1 } : {}),
  component: HomePage,
})

const POLL_MS = 60_000

interface Snapshot {
  items: FeedItem[]
  counts: Counts | null
  more: boolean
  capped?: boolean
  fetchedAt: number
  demo?: boolean
}

async function fetchViolations(params: Record<string, string>): Promise<Snapshot> {
  const query = new URLSearchParams(params).toString()
  const response = await fetch(`/api/violations${query ? `?${query}` : ''}`)
  if (!response.ok) throw new Error(String(response.status))
  return (await response.json()) as Snapshot
}

const timeFormat = new Intl.DateTimeFormat('bg-BG', {
  timeZone: 'Europe/Sofia',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

function when(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : timeFormat.format(date)
}

/** The home page's query for /signal, without ?demo. */
export function signalQuery(searchStr: string) {
  const params = new URLSearchParams(searchStr)
  params.delete('demo')
  const query = params.toString()
  return query ? `?${query}` : ''
}

function signalsWord(count: number) {
  return count === 1 ? 'сигнал' : 'сигнала'
}

function HomePage() {
  const search = Route.useSearch()
  const demo = search.demo === 1
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const signalHref = `/signal${signalQuery(searchStr)}`
  const { settled } = useRegistration()

  const [overview, setOverview] = useState<Snapshot | null>(null)
  const [extra, setExtra] = useState<FeedItem[]>([])
  const [more, setMore] = useState(false)
  const [error, setError] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [region, setRegion] = useState<string | null>(null)
  const [regionItems, setRegionItems] = useState<FeedItem[] | null>(null)
  const feedRef = useRef<HTMLElement>(null)

  const base = useMemo((): Record<string, string> => (demo ? { demo: '1' } : {}), [demo])

  const load = useCallback(async () => {
    try {
      const snapshot = await fetchViolations(base)
      setOverview(snapshot)
      setMore(snapshot.more)
      setExtra([])
      setError(false)
    } catch {
      setError(true)
    }
  }, [base])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // A region's own list comes from /violations/feed/<RR> (up to ~40), so it also has signals past the first page.
  useEffect(() => {
    if (!region) {
      setRegionItems(null)
      return
    }
    let cancelled = false
    setRegionItems(null)
    fetchViolations({ ...base, segment: region })
      .then((snapshot) => {
        if (!cancelled) setRegionItems(snapshot.items)
      })
      .catch(() => {
        if (!cancelled) setRegionItems([])
      })
    return () => {
      cancelled = true
    }
  }, [region, base, overview?.fetchedAt])

  const loaded = overview ? [...overview.items, ...extra] : []
  const items = region ? (regionItems ?? loaded.filter((item) => inSegment(item, region))) : loaded
  const counts = overview?.counts ?? null
  const total = counts?.total ?? 0

  async function showMore() {
    const last = loaded[loaded.length - 1]
    if (!last) return
    setLoadingMore(true)
    try {
      const page = await fetchViolations({ ...base, after: last.id })
      setExtra((current) => [...current, ...page.items])
      setMore(page.more)
    } catch {
      setError(true)
    } finally {
      setLoadingMore(false)
    }
  }

  function selectRegion(code: string | null) {
    setRegion(code)
    if (code) feedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const topRegions = counts
    ? Object.entries(counts.regions)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
    : []

  return (
    <div className="home-violations grid gap-6">
      {demo && overview?.demo ? (
        <p className="demo-note" role="note">
          <strong>Примерни данни.</strong> Това е преглед с измислени сигнали. Истинските се виждат без ?demo=1.
        </p>
      ) : null}

      <header className="grid gap-3">
        <h1 className="text-3xl font-black leading-tight">Сигнали от изборния ден</h1>
        <p className="text-lg leading-7">
          Президентски избори, 25 октомври 2026 г. Картата и списъкът показват сигналите, които екипът на Ти Броиш е прегледал и
          публикувал.
        </p>
        <a href={signalHref} className="brand-button">
          Подай сигнал
        </a>
        {settled ? (
          <p>
            Вече си записан. <Link to="/profil">Към профила</Link>
          </p>
        ) : null}
      </header>

      <div className="home-violations__body">
        <section className="grid content-start gap-3" aria-labelledby="map-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="map-heading" className="text-xl font-black text-[#444]">
              Карта
            </h2>
            <p className="text-sm text-[#666]" aria-live="polite">
              {overview ? (total ? `${total} ${signalsWord(total)}${overview.capped ? ' (последните)' : ''}` : 'Няма сигнали') : ''}
            </p>
          </div>
          <ViolationsMap regions={counts?.regions ?? {}} selected={region} onSelect={selectRegion} />
          <ol className="vm-legend" aria-label="Легенда">
            <li>
              <span className="vm-swatch vm-heat-0" /> няма
            </li>
            <li>
              <span className="vm-swatch vm-heat-1" /> малко
            </li>
            <li>
              <span className="vm-swatch vm-heat-3" />
            </li>
            <li>
              <span className="vm-swatch vm-heat-5" /> най-много
            </li>
          </ol>
          {topRegions.length ? (
            <div className="flex flex-wrap gap-2" aria-label="Райони с най-много сигнали">
              {topRegions.map(([code, count]) => (
                <button
                  key={code}
                  type="button"
                  className={`region-chip${region === code ? ' is-selected' : ''}`}
                  aria-pressed={region === code}
                  onClick={() => selectRegion(region === code ? null : code)}
                >
                  {regionName(code)} <span>{count}</span>
                </button>
              ))}
            </div>
          ) : null}
          {counts?.unplaced ? (
            <p className="text-sm text-[#666]">
              {counts.unplaced} {signalsWord(counts.unplaced)} от София без посочена секция не са на картата, но са в списъка.
            </p>
          ) : null}
        </section>

        <section ref={feedRef} className="grid content-start gap-3 scroll-mt-20" aria-labelledby="feed-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="feed-heading" className="text-xl font-black text-[#444]">
              {region ? regionName(region) : 'Последни сигнали'}
            </h2>
            {region ? (
              <button type="button" className="text-link" onClick={() => setRegion(null)}>
                Всички райони
              </button>
            ) : null}
          </div>

          {error && !overview ? (
            <p className="feed-empty">Сигналите не се заредиха. Опитваме пак след минута.</p>
          ) : !overview || (region && regionItems === null && items.length === 0) ? (
            <p className="feed-empty" aria-busy>
              Зареждаме сигналите…
            </p>
          ) : items.length === 0 ? (
            <div className="feed-empty">
              <p className="text-lg font-black text-[#444]">{region ? 'Няма публикувани сигнали от този район' : 'Все още няма публикувани сигнали'}</p>
              <p className="mt-1">
                Сигналите се появяват тук, след като екипът ги прегледа. Видя ли нарушение в секцията си? Подай сигнал.
              </p>
            </div>
          ) : (
            <ol className="grid gap-3">
              {items.map((item) => (
                <ViolationCard key={item.id} item={item} />
              ))}
            </ol>
          )}

          {!region && more && overview ? (
            <button type="button" className="secondary-button" onClick={() => void showMore()} disabled={loadingMore}>
              {loadingMore ? 'Зареждаме…' : 'Покажи още'}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function ViolationCard({ item }: { item: FeedItem }) {
  const place = item.country
    ? [item.town, item.country].filter(Boolean).join(', ')
    : [item.town, item.municipality && item.municipality !== item.town ? `община ${item.municipality}` : null].filter(Boolean).join(', ')
  return (
    <li className="violation-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#666]">
        {item.region ? <span className="region-tag">{regionName(item.region)}</span> : null}
        <time dateTime={item.createdAt}>{when(item.createdAt)}</time>
        {item.video ? <span className="region-tag region-tag--video">Видео</span> : null}
        {item.demo ? <span className="region-tag region-tag--demo">Пример</span> : null}
      </div>
      <h3 className="mt-1 font-black text-[#444]">{place || 'Без посочено място'}</h3>
      {item.section ? <p className="text-sm text-[#666]">Секция {item.section}</p> : null}
      {item.text ? <p className="mt-2 whitespace-pre-line leading-6">{item.text}</p> : null}
    </li>
  )
}

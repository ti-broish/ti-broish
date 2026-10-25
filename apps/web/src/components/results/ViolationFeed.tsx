import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { formatDateTime } from '../../home/results'
import { regionName } from '../../home/regions'
import { inSegment, type FeedItem } from '../../home/violations'

// results: ViolationFeeds.js — the published signals, newest first. A card opens /violation/<id>;
// the region and the section in it link to their pages. Data from /api/violations (worker-cached).

const POLL_MS = 60_000

interface Snapshot {
  items: FeedItem[]
  more: boolean
  demo?: boolean
}

async function fetchFeed(params: Record<string, string>): Promise<Snapshot> {
  const query = new URLSearchParams(params).toString()
  const response = await fetch(`/api/violations${query ? `?${query}` : ''}`)
  if (!response.ok) throw new Error(String(response.status))
  return (await response.json()) as Snapshot
}

/** The page's query for /signal, without ?demo (?origin=iaz and the rest go through). */
export function signalQuery(searchStr: string) {
  const params = new URLSearchParams(searchStr)
  params.delete('demo')
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function FeedCard({ item }: { item: FeedItem }) {
  const navigate = useNavigate()
  const open = () => void navigate({ to: '/violation/$id', params: { id: item.id } })
  return (
    <article
      className="rs-violation"
      data-testid="violation-card"
      role="link"
      tabIndex={0}
      aria-label={`Сигнал ${item.id}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === 'Enter') open()
      }}
    >
      <h4>
        {item.town}
        {item.municipality ? `, Община ${item.municipality}` : ''}
        {item.country ? `, ${item.country}` : ''}
      </h4>
      <h4>
        {item.region ? (
          <Link className="rs-link" to="/$unit" params={{ unit: item.region }} onClick={(event) => event.stopPropagation()}>
            Област {item.region}. {regionName(item.region)}
          </Link>
        ) : null}
        {item.region && item.section ? ', ' : ''}
        {item.section ? (
          <>
            Секция{' '}
            <Link className="rs-link" to="/$unit" params={{ unit: item.section }} onClick={(event) => event.stopPropagation()}>
              {item.section}
            </Link>
          </>
        ) : null}
      </h4>
      {item.section ? <h5 style={{ margin: '5px 0' }}>{item.place}</h5> : null}
      {item.createdAt ? <h5 style={{ color: '#888', margin: '5px 0' }}>Получен: {formatDateTime(item.createdAt)}</h5> : null}
      <p style={{ margin: '20px 0 20px 0' }}>{item.text}</p>
    </article>
  )
}

export function ViolationFeed({ segment, totalViolationsCount }: { segment?: string; totalViolationsCount?: number }) {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const demo = new URLSearchParams(searchStr).get('demo') === '1'
  const [items, setItems] = useState<FeedItem[] | null>(null)
  const [extra, setExtra] = useState<FeedItem[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [isDemo, setIsDemo] = useState(false)

  const load = useCallback(async () => {
    const params: Record<string, string> = {}
    if (demo) params.demo = '1'
    if (segment) params.segment = segment
    try {
      const snapshot = await fetchFeed(params)
      // The API's feed for 23/24/25 also returns Sofia signals without a section, which belong to no single МИР.
      setItems(segment ? snapshot.items.filter((item) => inSegment(item, segment)) : snapshot.items)
      setMore(!segment && snapshot.more)
      setIsDemo(Boolean(snapshot.demo))
      setExtra([])
      setError(false)
    } catch {
      setError(true)
      setItems((current) => current ?? [])
    }
  }, [demo, segment])

  useEffect(() => {
    setItems(null)
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const listed = items ? [...items, ...extra] : null

  async function showMore() {
    const last = listed?.[listed.length - 1]
    if (!last) return
    setLoading(true)
    try {
      const page = await fetchFeed({ ...(demo ? { demo: '1' } : {}), after: last.id })
      setExtra((current) => [...current, ...page.items])
      setMore(page.more)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rs-feed-block" aria-live="polite">
      <a className="rs-link" href={`/signal${signalQuery(searchStr)}`}>Подай сигнал &rarr;</a>
      {demo && isDemo ? (
        <p className="demo-note" role="note">
          <strong>Примерни данни.</strong> Това е преглед с измислени сигнали. Истинските се виждат без ?demo=1.
        </p>
      ) : null}
      {listed === null ? (
        <p className="rs-loading">Зареждане...</p>
      ) : listed.length > 0 ? (
        <div className="rs-feed">
          {listed.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
          {more ? (
            <button type="button" className="rs-show-more" disabled={loading} onClick={() => void showMore()}>
              {loading ? 'Зареждане...' : 'Покажи още'}
            </button>
          ) : null}
        </div>
      ) : error ? (
        <h5>Сигналите не се заредиха. Опитай пак след малко.</h5>
      ) : (totalViolationsCount ?? 0) > 0 ? (
        <h5>Няма публикувани сигнали</h5>
      ) : null}
    </div>
  )
}

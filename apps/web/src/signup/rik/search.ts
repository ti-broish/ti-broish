/** URL search for /admin/rik: which view and its filters. */
export const RIK_VIEWS = ['summary', 'people', 'tasks'] as const
export type RikView = (typeof RIK_VIEWS)[number]
export const RIK_TASK_SHOWS = ['open', 'done', 'all'] as const
export type RikTaskShow = (typeof RIK_TASK_SHOWS)[number]

export interface RikSearch {
  view: RikView
  mir: string
  status: string
  type: string
  show: RikTaskShow
  q: string
  page: number
}

export const defaultRikSearch: RikSearch = { view: 'summary', mir: '', status: '', type: '', show: 'open', q: '', page: 1 }

function oneOf<T extends string>(value: unknown, list: readonly T[], fallback: T): T {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback
}

export function parseRikSearch(search: Record<string, unknown>): RikSearch {
  const mir = typeof search.mir === 'string' || typeof search.mir === 'number' ? String(search.mir).replace(/\D/g, '').slice(0, 2) : ''
  const page = Number(search.page)
  return {
    view: oneOf(search.view, RIK_VIEWS, 'summary'),
    mir: mir ? mir.padStart(2, '0') : '',
    status: typeof search.status === 'string' ? search.status.replace(/[^a-z_]/g, '').slice(0, 30) : '',
    type: typeof search.type === 'string' ? search.type.replace(/[^a-z_]/g, '').slice(0, 30) : '',
    show: oneOf(search.show, RIK_TASK_SHOWS, 'open'),
    q: typeof search.q === 'string' ? search.q.slice(0, 80) : '',
    page: Number.isFinite(page) && page >= 1 ? Math.min(500, Math.floor(page)) : 1,
  }
}

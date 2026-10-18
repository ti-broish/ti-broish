export type BrevoListSummary = {
  id: number
  name: string
  subscribers: number
}

type BrevoListApiRow = {
  id?: unknown
  name?: unknown
  uniqueSubscribers?: unknown
  totalSubscribers?: unknown
}

/** Parse GET /contacts/lists JSON into summaries sorted newest-first (highest id). */
export function parseBrevoLists(json: unknown): BrevoListSummary[] {
  if (!json || typeof json !== 'object') return []
  const bag = json as { lists?: unknown }
  if (!Array.isArray(bag.lists)) return []
  const lists: BrevoListSummary[] = []
  for (const item of bag.lists) {
    if (!item || typeof item !== 'object') continue
    const row = item as BrevoListApiRow
    if (typeof row.id !== 'number' || !Number.isFinite(row.id) || row.id <= 0) continue
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : `Списък ${row.id}`
    const unique = typeof row.uniqueSubscribers === 'number' ? row.uniqueSubscribers : null
    const total = typeof row.totalSubscribers === 'number' ? row.totalSubscribers : null
    lists.push({
      id: row.id,
      name,
      subscribers: unique ?? total ?? 0,
    })
  }
  return lists.sort((a, b) => b.id - a.id)
}

/** Bulgarian select label: „Име (N контакта)“ / „Име (1 контакт)“. */
export function brevoListLabel(list: { name: string; subscribers: number }) {
  const noun = list.subscribers === 1 ? 'контакт' : 'контакта'
  return `${list.name} (${list.subscribers} ${noun})`
}

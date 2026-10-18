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

/** „1 контакт“ / „N контакта“. */
export function brevoContactCount(count: number) {
  return `${count} ${count === 1 ? 'контакт' : 'контакта'}`
}

/**
 * Display names for lists: the plain name, plus „ · #id“ only when another
 * list has the same name (case-insensitive), so duplicates stay distinguishable.
 */
export function brevoListDisplayNames(lists: Array<{ id: number; name: string }>): Map<number, string> {
  const counts = new Map<string, number>()
  for (const list of lists) {
    const key = list.name.trim().toLocaleLowerCase('bg')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const names = new Map<number, string>()
  for (const list of lists) {
    const duplicate = (counts.get(list.name.trim().toLocaleLowerCase('bg')) ?? 0) > 1
    names.set(list.id, duplicate ? `${list.name} · #${list.id}` : list.name)
  }
  return names
}

/** Bulgarian select label: „Име (N контакта)“ / „Име (1 контакт)“. Pass a display name to disambiguate duplicates. */
export function brevoListLabel(list: { name: string; subscribers: number }, displayName?: string) {
  return `${displayName ?? list.name} (${brevoContactCount(list.subscribers)})`
}

/** Dry-run summary: „Ще се синхронизират N контакта към списък „Име“.“ */
export function brevoSyncPreviewText(total: number, listName: string) {
  const verb = total === 1 ? 'Ще се синхронизира' : 'Ще се синхронизират'
  return `${verb} ${brevoContactCount(total)} към списък „${listName}“.`
}

/** Lowercased, NFC-normalised, whitespace-collapsed text for Cyrillic-friendly matching. */
export function brevoListSearchKey(value: string) {
  return value.normalize('NFC').toLocaleLowerCase('bg').replace(/\s+/gu, ' ').trim()
}

/**
 * Filter list options by typed text: case-insensitive substring of the name, or the
 * list id (digits, optionally prefixed with „#“). An exact id match comes first.
 */
export function filterBrevoListOptions<T extends { id: number; name: string }>(options: T[], query: string): T[] {
  const needle = brevoListSearchKey(query)
  if (!needle) return options
  const idNeedle = /^#?\d+$/u.test(needle) ? needle.replace(/^#/u, '') : ''
  const matches = options.filter(
    (option) =>
      brevoListSearchKey(option.name).includes(needle) || (idNeedle !== '' && String(option.id).includes(idNeedle)),
  )
  if (!idNeedle) return matches
  const exact = matches.filter((option) => String(option.id) === idNeedle)
  return [...exact, ...matches.filter((option) => String(option.id) !== idNeedle)]
}

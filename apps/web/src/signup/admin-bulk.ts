/** Ids a bulk callback may touch. Anything else is dropped before it reaches SQL. */
export const CALLBACK_ID = /^[\w-]{1,80}$/
export const CALLBACK_ID_CAP = 200
export const CALLBACK_FILTER_CAP = 500
export const CALLBACK_CHUNK = 80

export function callbackIds(values: readonly unknown[]) {
  const seen = new Set<string>()
  const ids: string[] = []
  let overflow = false
  for (const value of values) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (!CALLBACK_ID.test(id) || seen.has(id)) continue
    if (ids.length >= CALLBACK_ID_CAP) {
      overflow = true
      continue
    }
    seen.add(id)
    ids.push(id)
  }
  return { ids, truncated: overflow }
}

export function chunkIds<T>(ids: readonly T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size))
  return chunks
}

/** Only the staff callback columns. The team note, the payload and the national number stay put. */
export function callbackSetSql(mark: boolean, count: number) {
  const marks = Array.from({ length: count }, () => '?').join(', ')
  const pending = mark ? "COALESCE(staff_called_at, '') = ''" : "COALESCE(staff_called_at, '') != ''"
  return `UPDATE signups SET staff_called_at = ?, staff_called_by = ?, updated_at = ? WHERE id IN (${marks}) AND ${pending}`
}

export function callbackMessage(mark: boolean, updated: number, capped: boolean) {
  if (updated === 0) {
    return mark ? 'Няма хора без отбелязано обаждане в този избор.' : 'Няма отбелязано обаждане в този избор.'
  }
  const noun = updated === 1 ? 'човек' : 'души'
  const action = mark ? `Отбелязахме обаждане за ${updated} ${noun}.` : `Махнахме обаждането за ${updated} ${noun}.`
  return capped ? `${action} В изгледа има още.` : action
}

export function toggleSelected(selected: ReadonlySet<string>, id: string, on: boolean) {
  const next = new Set(selected)
  if (on) next.add(id)
  else next.delete(id)
  return next
}

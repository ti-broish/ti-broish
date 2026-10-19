/** Sequential integers, stable once assigned. Gaps from deleted rows are not reused. */
export function nextDesignationNumber(existing: Array<number | null | undefined>) {
  let max = 0
  for (const value of existing) {
    if (typeof value === 'number' && Number.isFinite(value) && value > max) max = value
  }
  return max + 1
}

export function parseStoredNumber(value: string | number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  if (typeof value !== 'string') return null
  const match = value.trim().match(/(\d+)\s*$/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export interface DesignationNumberPlanRow {
  id: string
  publishedSection: string
  createdAt: string
  number: number | null
  issuedAt: string | null
}

export interface DesignationNumberUpdate {
  id: string
  number: number
  issuedAt: string
  assigned: boolean
}

/** Stable MAX+1 assignment. Never renumbers. Order: published_section, created_at, id. */
export function planDesignationNumbering(
  rows: DesignationNumberPlanRow[],
  existingMax: number,
  issuedOn: string,
): { updates: DesignationNumberUpdate[]; assigned: number } {
  const ordered = [...rows].sort((a, b) => {
    const section = a.publishedSection.localeCompare(b.publishedSection)
    if (section) return section
    const created = a.createdAt.localeCompare(b.createdAt)
    if (created) return created
    return a.id.localeCompare(b.id)
  })
  let next = nextDesignationNumber([existingMax, ...ordered.map((row) => row.number)])
  const updates: DesignationNumberUpdate[] = []
  for (const row of ordered) {
    const existing = parseStoredNumber(row.number)
    const assigned = existing == null
    const number = existing ?? next
    if (assigned) next += 1
    const issuedAt = (row.issuedAt ?? '').trim() || issuedOn
    if (!assigned && (row.issuedAt ?? '').trim()) continue
    updates.push({ id: row.id, number, issuedAt, assigned })
  }
  return { updates, assigned: updates.filter((row) => row.assigned).length }
}

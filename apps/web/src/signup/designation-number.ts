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

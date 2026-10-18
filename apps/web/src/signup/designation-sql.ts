export function sqlLiteral(value: string | number | null) {
  if (value === null) return 'NULL'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return `'${String(value).replace(/'/g, "''")}'`
}

export function sqlIdent(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Невалидно SQL име.')
  return value
}

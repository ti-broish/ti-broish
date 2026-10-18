export function sqlLiteral(value: string | number | null) {
  if (value === null) return 'NULL'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return `'${String(value).replace(/'/g, "''")}'`
}

export function sqlIdent(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Невалидно SQL име.')
  return value
}

export function sqlBatches<T>(items: readonly T[], size: number) {
  const batches: T[][] = []
  const step = Math.max(1, Math.floor(size) || 1)
  for (let index = 0; index < items.length; index += step) batches.push(items.slice(index, index + step))
  return batches
}

/** Lookup for the Drive-link import. Never selects ЕГН. */
export function designationImportLookupSql(ids: string[], emails: string[]) {
  const clauses: string[] = []
  if (ids.length > 0) clauses.push(`id IN (${ids.map((id) => sqlLiteral(id)).join(', ')})`)
  if (emails.length > 0) {
    clauses.push(`lower(email) IN (${emails.map((email) => sqlLiteral(email.trim().toLowerCase())).join(', ')})`)
  }
  if (clauses.length === 0) return null
  return `SELECT id, email, COALESCE(published_section, '') AS published_section FROM signups WHERE ${clauses.join(' OR ')}`
}

export function designationLinkUpdateSql(
  row: { id: string; pdfUrl: string; driveFileId: string | null },
  updatedAt: string,
) {
  const fileId = row.driveFileId?.trim() ? row.driveFileId.trim() : null
  return `UPDATE signups SET designation_pdf_url = ${sqlLiteral(row.pdfUrl)}, designation_drive_file_id = ${sqlLiteral(fileId)}, updated_at = ${sqlLiteral(updatedAt)} WHERE id = ${sqlLiteral(row.id)};`
}

export function designationLinkUpdateBatchSql(
  rows: Array<{ id: string; pdfUrl: string; driveFileId: string | null }>,
  updatedAt: string,
) {
  return rows.map((row) => designationLinkUpdateSql(row, updatedAt)).join('\n')
}

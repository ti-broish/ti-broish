/**
 * SET clause for a signed upload (binds one timestamp): records when the signed file first came.
 * The wave never depends on it: a wave is the date printed in the PDF (designation_issued_at).
 */
export const SIGNED_WAVE_SET_SQL = 'designation_first_signed_at = COALESCE(designation_first_signed_at, designation_signed_at, ?)'

/** Added at runtime by db-core and in sql/2026-10-20-signed-waves.sql. */
export const SIGNED_WAVE_COLUMNS = [
  'ALTER TABLE signups ADD COLUMN designation_first_signed_at TEXT',
  'ALTER TABLE partner_people ADD COLUMN designation_first_signed_at TEXT',
]

/**
 * Closed waves (sql/2026-10-29-signing-waves.sql, also applied at runtime by db-core).
 * A wave is a date from the PDF. „Изпратена на РИК“ closes the open wave of that date: everyone
 * signed, numbered with that date and no wave yet gets designation_wave_id. Anyone numbered or
 * signed later with the same date is the next (open) wave, even on a date already sent. A signed
 * upload never touches designation_wave_id.
 * issue_date is YYYY-MM-DD.
 */
export const SIGNING_WAVE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS signing_waves (
  id TEXT PRIMARY KEY,
  issue_date TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  closed_by TEXT NOT NULL DEFAULT ''
)`,
  'ALTER TABLE signups ADD COLUMN designation_wave_id TEXT',
  'ALTER TABLE partner_people ADD COLUMN designation_wave_id TEXT',
]

/**
 * designation_issued_at as YYYY-MM-DD. Most rows hold dd.mm.yyyy (Sofia); a few were written as
 * YYYY-MM-DD. Anything else gives ''.
 */
export function issueDateKeySql(column = 'designation_issued_at') {
  return `(CASE WHEN ${column} LIKE '__.__.____' THEN substr(${column}, 7, 4) || '-' || substr(${column}, 4, 2) || '-' || substr(${column}, 1, 2)
    WHEN ${column} LIKE '____-__-__%' THEN substr(${column}, 1, 10) ELSE '' END)`
}

/**
 * Numbered, signed, no wave yet, issued on ?2 (YYYY-MM-DD). Only signed people are sent to the РИК,
 * so only they join the closed wave; an unsigned one stays open and shows up in the open wave of
 * their date once their signed file comes.
 */
const pendingWhere = `designation_number IS NOT NULL AND designation_signed_at IS NOT NULL AND designation_wave_id IS NULL AND ${issueDateKeySql()} = ?2`

/**
 * Close the open wave of one date, as one D1 batch (one transaction). Binds: ?1 new wave id,
 * ?2 issue date YYYY-MM-DD, ?3 closed_at, ?4 closed_by. The wave row is written only when
 * someone is waiting, so a second click adds nothing.
 */
export const CLOSE_WAVE_SQL = [
  `INSERT INTO signing_waves (id, issue_date, closed_at, closed_by)
  SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM signups WHERE ${pendingWhere}) OR EXISTS (SELECT 1 FROM partner_people WHERE ${pendingWhere})`,
  `UPDATE signups SET designation_wave_id = ?1 WHERE ${pendingWhere} AND EXISTS (SELECT 1 FROM signing_waves WHERE id = ?1)`,
  `UPDATE partner_people SET designation_wave_id = ?1 WHERE ${pendingWhere} AND EXISTS (SELECT 1 FROM signing_waves WHERE id = ?1)`,
]

export const CLOSED_WAVES_SQL = 'SELECT id, issue_date, closed_at, closed_by FROM signing_waves ORDER BY issue_date, closed_at, id'

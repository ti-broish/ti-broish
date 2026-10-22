// Which partner (?origin= on /signal) sent a signal. The signal itself lives in the Ти Броиш API
// (Postgres, upravitel.tibroish.bg), which has no source field; this D1 table keys the origin by the
// API's violation id. Additive, also in sql/2026-10-22-signal-origins.sql.
import { signalOrigin, type SignalOrigin } from './signal-prefill'

export const SIGNAL_ORIGINS_TABLE = `CREATE TABLE IF NOT EXISTS signal_origins (
  violation_id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL
)`

export const SIGNAL_ORIGIN_INSERT = `INSERT INTO signal_origins (violation_id, origin, created_at) VALUES (?, ?, ?)
ON CONFLICT(violation_id) DO NOTHING`

export interface SignalOriginInput {
  violationId: unknown
  origin: unknown
}

export interface SignalOriginRecord {
  violationId: string
  origin: SignalOrigin
}

/** The API's violation ids are ULIDs; anything that does not look like one is refused. */
export function signalOriginRecord(input: SignalOriginInput | null | undefined): SignalOriginRecord | null {
  const origin = signalOrigin(input?.origin)
  const id = typeof input?.violationId === 'string' ? input.violationId.trim() : ''
  if (!origin || !/^[0-9A-Za-z]{20,40}$/.test(id)) return null
  return { violationId: id, origin }
}

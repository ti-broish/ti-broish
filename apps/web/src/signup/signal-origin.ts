import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { SIGNAL_ORIGIN_INSERT, SIGNAL_ORIGINS_TABLE, signalOriginRecord, type SignalOriginInput } from './signal-origin-sql'

interface OriginD1 {
  prepare(sql: string): { run(): Promise<unknown>; bind(...values: unknown[]): { run(): Promise<unknown> } }
}

/**
 * Called by /signal after the API accepted a signal that came with ?origin=. Best effort: the signal
 * is already sent, so a failure here only loses the partner tag. Own table, so the signup schema
 * bootstrap is not touched.
 */
export const recordSignalOrigin = createServerFn({ method: 'POST' })
  .validator((input: SignalOriginInput) => input)
  .handler(async ({ data }) => {
    const record = signalOriginRecord(data)
    if (!record) return { ok: false as const }
    const db = (env as unknown as { DB?: OriginD1 }).DB
    if (!db) return { ok: false as const }
    await db.prepare(SIGNAL_ORIGINS_TABLE).run()
    await db.prepare(SIGNAL_ORIGIN_INSERT).bind(record.violationId, record.origin, new Date().toISOString()).run()
    return { ok: true as const }
  })

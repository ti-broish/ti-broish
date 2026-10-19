/** Client-safe wording for the Brevo part of /admin/palnomoshtni (no server imports). */

export type UploadBrevo =
  | { ok: true; attribute: string; created?: boolean }
  | { ok: false; attribute: string; skipped?: boolean; error: string }

export type BrevoTone = 'ok' | 'error' | 'busy'
export type BrevoStatus = { tone: BrevoTone; text: string }

/** Read the `brevo` field of an upload response; old responses without it count as not synced. */
export function uploadBrevoOf(body: unknown): UploadBrevo {
  const brevo = (body && typeof body === 'object' ? (body as { brevo?: unknown }).brevo : undefined) as
    | { ok?: unknown; attribute?: unknown; created?: unknown; skipped?: unknown; error?: unknown }
    | undefined
  const attribute = typeof brevo?.attribute === 'string' && brevo.attribute ? brevo.attribute : 'DOCUMENT_URL'
  if (!brevo) return { ok: false, attribute, error: 'сървърът не върна резултат за Brevo' }
  if (brevo.ok === true) return { ok: true, attribute, created: brevo.created === true }
  return {
    ok: false,
    attribute,
    skipped: brevo.skipped === true,
    error: typeof brevo.error === 'string' && brevo.error ? brevo.error : 'неизвестна грешка',
  }
}

/** Text of the Brevo cell next to an uploaded file. */
export function uploadBrevoCell(brevo: UploadBrevo) {
  if (brevo.ok) return brevo.created ? 'създаден контакт' : 'обновен'
  if (brevo.skipped) return `пропуснат: ${brevo.error}`
  return `грешка: ${brevo.error}`
}

/** "Brevo (DOCUMENT_URL): 3 обновени / 1 грешки (от 4): reason" */
export function brevoCountsLine(attribute: string, updated: number, errors: string[], total?: number) {
  const of = total !== undefined && total !== updated + errors.length ? ` (от ${total})` : ''
  const head = `Brevo (${attribute || 'DOCUMENT_URL'}): ${updated} обновени / ${errors.length} грешки${of}`
  const reasons = [...new Set(errors.map((error) => error || 'неизвестна грешка'))].slice(0, 3)
  return reasons.length ? `${head}: ${reasons.join('; ')}` : `${head}.`
}

/** Summary after a bulk upload: Drive counts plus what Brevo answered for the uploaded people. */
export function uploadSummary(matched: number, uploaded: UploadBrevo[]) {
  const head = `Качени ${uploaded.length} от ${matched}`
  if (uploaded.length === 0) return { tone: 'error' as const, text: `${head}.` }
  const attribute = uploaded[0]?.attribute ?? 'DOCUMENT_URL'
  const errors = uploaded.filter((row): row is Extract<UploadBrevo, { ok: false }> => !row.ok).map((row) => row.error)
  const updated = uploaded.length - errors.length
  const tone = errors.length === 0 && uploaded.length === matched ? ('ok' as const) : ('error' as const)
  return { tone, text: `${head}; ${brevoCountsLine(attribute, updated, errors)}` }
}

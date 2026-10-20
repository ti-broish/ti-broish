/** Admin unregister / restore helpers. Pure logic stays here; server fns live in admin-unregister-actions. */

export const WITHDRAW_REASONS = ['call_quit', 'sik_member', 'other'] as const
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number]

export const WITHDRAW_REASON_LABELS: Record<WithdrawReason, string> = {
  call_quit: 'Отказа се (обаждане)',
  sik_member: 'Ще бъде член на СИК',
  other: 'Друго',
}

const NOTE_LIMIT = 400

export function parseWithdrawReason(value: unknown): WithdrawReason | null {
  return WITHDRAW_REASONS.includes(value as WithdrawReason) ? (value as WithdrawReason) : null
}

export function clipWithdrawNote(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, NOTE_LIMIT) : ''
}

/** Volunteer withdrew from /profil. Not an admin choice, so it is not in WITHDRAW_REASONS. */
export const SELF_WITHDRAW_REASON = 'self'
export const SELF_WITHDRAW_LABEL = 'Оттегли се от профила'

export function withdrawReasonLabel(reason: string | null | undefined) {
  if (!reason) return ''
  if (reason === SELF_WITHDRAW_REASON) return SELF_WITHDRAW_LABEL
  return WITHDRAW_REASON_LABELS[reason as WithdrawReason] ?? reason
}

/** Human text for the audit "before" side when unregistering (active → withdrawn). */
export function withdrawAuditBefore(draftSection: string, publishedSection: string) {
  const draft = draftSection.trim()
  const published = publishedSection.trim()
  const parts: string[] = ['Активен']
  if (published) parts.push(`публикувана ${published}`)
  if (draft && draft !== published) parts.push(`чернова ${draft}`)
  return parts.join(' · ')
}

/** Human text for the audit "after" side when unregistering. */
export function withdrawAuditAfter(reason: string, note: string, draftSection: string, publishedSection: string) {
  const draft = draftSection.trim()
  const published = publishedSection.trim()
  const freed: string[] = []
  if (published) freed.push(`освободена публикувана ${published}`)
  if (draft && draft !== published) freed.push(`освободена чернова ${draft}`)
  if (!freed.length) freed.push('без секция')
  const notePart = note ? ` · ${note}` : ''
  return `Отписан · ${withdrawReasonLabel(reason)}${notePart} · ${freed.join(' · ')}`
}

/** Audit "before" when restoring: what the withdrawal looked like. */
export function restoreAuditBefore(reason: string | null | undefined, note: string | null | undefined, freedSection: string) {
  const label = withdrawReasonLabel(reason) || 'Отписан'
  const notePart = note?.trim() ? ` · ${note.trim()}` : ''
  const sectionPart = freedSection.trim() ? ` · предишна секция ${freedSection.trim()}` : ''
  return `Отписан · ${label}${notePart}${sectionPart}`
}

export function restoreAuditAfter() {
  return 'Възстановен · секцията не се връща автоматично'
}

export type BrevoListOutcome =
  | { ok: true; action: 'removed' | 'added' | 'skipped'; detail: string }
  | { ok: false; action: 'removed' | 'added' | 'skipped'; detail: string }

/** Audit text that marks a finished Brevo cleanup; the admin cleanup skips people who have it. */
export const BREVO_CLEANED_MARK = 'Brevo: изчистен'

export function brevoOutcomeAuditSuffix(outcome: BrevoListOutcome) {
  if (outcome.action === 'skipped') return ` · Brevo: ${outcome.detail}`
  if (outcome.ok) return ` · Brevo: ${outcome.detail}`
  return ` · Brevo (неуспех): ${outcome.detail}`
}

/** Parse a freed section from an unregister audit "after" line (for the restore UI). */
export function freedSectionFromAuditAfter(after: string) {
  const published = after.match(/освободена публикувана\s+([A-Z0-9]+)/i)
  if (published?.[1]) return published[1]
  const draft = after.match(/освободена чернова\s+([A-Z0-9]+)/i)
  if (draft?.[1]) return draft[1]
  return ''
}

const RELEASE_SECTIONS = `draft_section = NULL,
    draft_locked = 0,
    published_section = NULL,
    published_at = NULL`

/**
 * Active → withdrawn, for the admin „Отпиши“ and the volunteer's own „Оттегли записването“.
 * Binds: withdrawn_at, withdrawn_by, reason, note, byAdmin ('true' | 'false'), updated_at, id.
 * Frees the section; the пълномощно (designation_*) stays as it is.
 */
export function unregisterSql() {
  return `UPDATE signups SET
    withdrawn = 1,
    withdrawn_at = ?,
    withdrawn_by = ?,
    withdrawn_reason = ?,
    withdrawn_note = ?,
    ${RELEASE_SECTIONS},
    payload = json_set(COALESCE(payload, '{}'), '$.withdrawn', json('true'), '$.withdrawnByAdmin', json(?), '$.assignedSection', json('null')),
    updated_at = ?
  WHERE id = ? AND COALESCE(withdrawn, 0) = 0`
}

/** Already withdrawn but still holding a section: what /profil used to leave behind. */
export const WITHDRAWN_HOLDING_SECTION = `COALESCE(withdrawn, 0) = 1 AND (COALESCE(draft_section, '') != '' OR COALESCE(published_section, '') != '')`

/**
 * Backfill for those rows. Keeps any withdrawn_* already set; otherwise the withdrawal time is the
 * row's last update (the self-withdraw save) and the actor is the volunteer.
 * Binds: withdrawn_at fallback, withdrawn_by fallback, reason fallback, updated_at, id.
 */
export function releaseWithdrawnSql() {
  return `UPDATE signups SET
    withdrawn_at = COALESCE(withdrawn_at, ?),
    withdrawn_by = COALESCE(withdrawn_by, ?),
    withdrawn_reason = COALESCE(withdrawn_reason, ?),
    ${RELEASE_SECTIONS},
    payload = json_set(COALESCE(payload, '{}'), '$.assignedSection', json('null')),
    updated_at = ?
  WHERE id = ? AND ${WITHDRAWN_HOLDING_SECTION}`
}

/** Audit "before" for the backfill: withdrawn, but the seat was still held. */
export function releaseAuditBefore(draftSection: string, publishedSection: string) {
  return withdrawAuditBefore(draftSection, publishedSection).replace(/^Активен/, 'Оттеглен, но държи секция')
}

export function restoreSql() {
  return `UPDATE signups SET
    withdrawn = 0,
    withdrawn_at = NULL,
    withdrawn_by = NULL,
    withdrawn_reason = NULL,
    withdrawn_note = NULL,
    payload = json_set(COALESCE(payload, '{}'), '$.withdrawn', json('false'), '$.withdrawnByAdmin', json('false')),
    updated_at = ?
  WHERE id = ? AND COALESCE(withdrawn, 0) = 1`
}

export function unregisterMessage(updated: number, capped: boolean) {
  if (updated === 0) return 'Няма активни хора в този избор за отписване.'
  const noun = updated === 1 ? 'човек' : 'души'
  const action = `Отписахме ${updated} ${noun}.`
  return capped ? `${action} В изгледа има още.` : action
}

export function restoreMessage() {
  return 'Върнахме записването. Секцията не се възстановява автоматично.'
}

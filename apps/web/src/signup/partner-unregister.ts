/**
 * „Отпиши“ for an „И аз“ person (partner_people), the same as for a volunteer: the row becomes
 * withdrawn (withdrawn_at), its section (draft and published) is freed, and the пълномощно number
 * and МИР stay (history; numbers are never reused). „Върни“ makes it active again; the section
 * does not come back. Audit lines use the volunteer fields ('withdrawn' / 'restored') and texts.
 * Client-safe: SQL strings and pure helpers only. No mail, no Brevo.
 */
import { WITHDRAW_REASON_LABELS, clipWithdrawNote, parseWithdrawReason, withdrawAuditAfter, withdrawAuditBefore, type WithdrawReason } from './admin-unregister'
import { PARTNER_WITHDRAW_REASON_MAX } from './designation-audit-sql'

/** Binds: ?1 withdrawn_at (also updated_at), ?2 actor, ?3 reason text, ?4 id. Only an active row changes. */
export const PARTNER_UNREGISTER_SQL = `UPDATE partner_people SET
    withdrawn_at = ?1,
    withdrawn_by = ?2,
    withdrawn_reason = ?3,
    section_draft = NULL,
    section_draft_locked = 0,
    section_draft_source = NULL,
    section_published = NULL,
    section_published_at = NULL,
    updated_at = ?1
  WHERE id = ?4 AND withdrawn_at IS NULL`

/** Binds: ?1 updated_at, ?2 id. Only a withdrawn row changes; number, МИР and section stay as they are. */
export const PARTNER_RESTORE_SQL = `UPDATE partner_people SET withdrawn_at = NULL, withdrawn_by = NULL, withdrawn_reason = NULL, updated_at = ?1
  WHERE id = ?2 AND withdrawn_at IS NOT NULL`

/** The section freed by the latest „Отпиши“ of this person, from its audit line. Binds: id. */
export const PARTNER_LAST_FREED_SQL = `SELECT after_text FROM signup_audit WHERE signup_id = ? AND field = 'withdrawn' ORDER BY created_at DESC, id DESC LIMIT 1`

/** partner_people keeps one free-text reason (also shown on Пълномощни): the label, then the note. */
export function partnerWithdrawnReasonText(reason: WithdrawReason, note: string) {
  return [WITHDRAW_REASON_LABELS[reason], note].filter(Boolean).join(' · ').slice(0, PARTNER_WITHDRAW_REASON_MAX)
}

export function parsePartnerUnregister(input: { reason?: unknown; note?: unknown }) {
  const reason = parseWithdrawReason(input?.reason)
  return { reason, note: clipWithdrawNote(input?.note) }
}

export function partnerUnregisterAuditBefore(person: { draft: string; published: string; mir: string; number: number | null }) {
  const number = person.number != null ? ` · № ${person.mir}/${person.number}` : ''
  return `${withdrawAuditBefore(person.draft, person.published)}${number}`
}

export function partnerUnregisterAuditAfter(reason: WithdrawReason, note: string, person: { draft: string; published: string; number: number | null }) {
  const kept = person.number != null ? ' · номерът остава' : ''
  return `${withdrawAuditAfter(reason, note, person.draft, person.published)}${kept}`
}

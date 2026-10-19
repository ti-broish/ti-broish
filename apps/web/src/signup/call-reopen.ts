/** Badge text for a person the team has already called. */
export const CALLED_LABEL = 'Обадили сме се'

export interface CallRequestState {
  callRequestedAt: string | null
  callMessage: string
}

function openCall(state: CallRequestState | null | undefined) {
  return Boolean(state?.callRequestedAt && state.callMessage.trim())
}

/**
 * True when a volunteer save carries a fresh call request after the team already called.
 * Fresh means: no open request before, a changed reason, or a newer request timestamp.
 * Re-saving the same request leaves the team's mark alone.
 */
export function callRequestRenewed(before: CallRequestState | null, after: CallRequestState, staffCalledAt: string) {
  if (!staffCalledAt.trim() || !openCall(after)) return false
  if (!before || !openCall(before)) return true
  if (before.callMessage.trim() !== after.callMessage.trim()) return true
  const at = after.callRequestedAt ?? ''
  return at !== (before.callRequestedAt ?? '') && at > staffCalledAt
}

/** Clears the team's mark only if it is still the one we read, so the person reappears in the queue. */
export function reopenCalledSql() {
  return `UPDATE signups SET staff_called_at = NULL, staff_called_by = NULL WHERE id = ? AND staff_called_at = ?`
}

export function calledText(at: string, by: string) {
  const date = new Date(at)
  const when = Number.isNaN(date.getTime())
    ? at
    : new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Sofia' }).format(date)
  return by ? `${CALLED_LABEL} на ${when} от ${by}` : `${CALLED_LABEL} на ${when}`
}

/** The only history row a volunteer save writes: the team's old call, kept when a new request reopens it. */
export const CALL_REOPEN_AUDIT_SQL = `INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`

/** Audit row kept when a new request reopens a closed call: the old mark stays readable in history. */
export function callReopenAudit(staffCalledAt: string, staffCalledBy: string, message: string) {
  const reason = message.trim()
  return {
    field: 'call_reopened' as const,
    before: calledText(staffCalledAt, staffCalledBy),
    after: reason ? `Нова заявка за обаждане: ${reason.length > 280 ? `${reason.slice(0, 279)}…` : reason}` : 'Нова заявка за обаждане',
  }
}

/** The call request stored in a signup payload, or null when the payload is missing or unreadable. */
export function callRequestFromPayload(payload: string | null | undefined): CallRequestState | null {
  if (!payload) return null
  try {
    const parsed = JSON.parse(payload) as { callRequestedAt?: unknown; callMessage?: unknown }
    return {
      callRequestedAt: typeof parsed.callRequestedAt === 'string' && parsed.callRequestedAt ? parsed.callRequestedAt : null,
      callMessage: typeof parsed.callMessage === 'string' ? parsed.callMessage : '',
    }
  } catch {
    return null
  }
}

/** A renewed request gets a timestamp after the old call, so the queue shows when it was asked again. */
export function renewedRequestAt(callRequestedAt: string | null, staffCalledAt: string, now: string) {
  return callRequestedAt && callRequestedAt > staffCalledAt ? callRequestedAt : now
}

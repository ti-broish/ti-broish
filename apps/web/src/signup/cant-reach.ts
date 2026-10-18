/** Call-message limit. Raised from 300 so an appended can't-reach note still fits. */
export const CALL_MESSAGE_MAX = 500

export interface CantReachSection {
  section: string
  at: string
}

const SEPARATOR = ' · '

/** Stem used for idempotency checks (without trailing punctuation or note). */
export function cantReachStem(section: string) {
  return `Не мога да стигна до секция ${section.trim()}`
}

export function cantReachAlreadyPresent(message: string, section: string) {
  return message.includes(cantReachStem(section))
}

/**
 * Build or append the can't-reach call message.
 * - New request: `Не мога да стигна до секция <section>.` + optional ` <note>`
 * - Existing open message: append with ` · `, using `: <note>` when a note is given
 * - Same stem already present → leave message unchanged (idempotent)
 * - Prefer keeping the new phrase when trimming to CALL_MESSAGE_MAX
 */
export function buildCantReachMessage(input: {
  existingMessage: string
  section: string
  note?: string
}): string {
  const section = input.section.trim()
  const note = (input.note ?? '').trim()
  const existing = input.existingMessage.trim()
  if (!section) return existing.slice(0, CALL_MESSAGE_MAX)

  const stem = cantReachStem(section)
  if (cantReachAlreadyPresent(existing, section)) return existing.slice(0, CALL_MESSAGE_MAX)

  const addition = note ? (existing ? `${stem}: ${note}` : `${stem}. ${note}`) : `${stem}.`

  if (!existing) return addition.slice(0, CALL_MESSAGE_MAX)
  return fitCallMessage(existing, addition)
}

/** Keep the newest phrase; trim the older prefix when over the limit. */
export function fitCallMessage(existing: string, addition: string, max = CALL_MESSAGE_MAX) {
  const full = `${existing}${SEPARATOR}${addition}`
  if (full.length <= max) return full
  const room = max - SEPARATOR.length - addition.length
  if (room < 1) return addition.slice(0, max)
  return `${existing.slice(0, room).trimEnd()}${SEPARATOR}${addition}`.slice(0, max)
}

export function applyCantReachReport(input: {
  callMessage: string
  callRequestedAt: string | null
  section: string
  note?: string
  now: string
}): {
  callMessage: string
  callRequestedAt: string
  cantReachSection: CantReachSection
} {
  const section = input.section.trim()
  return {
    callMessage: buildCantReachMessage({
      existingMessage: input.callMessage,
      section,
      note: input.note,
    }),
    callRequestedAt: input.callRequestedAt || input.now,
    cantReachSection: { section, at: input.now },
  }
}

/**
 * Drop a stale flag when the published section changed or is gone.
 * The call-message text is left as historical context.
 */
export function normalizeCantReachSection<
  T extends { cantReachSection?: CantReachSection | null; assignedSection: string | null },
>(profile: T): T {
  const flag = profile.cantReachSection
  if (!flag || typeof flag !== 'object') return { ...profile, cantReachSection: null }
  const section = String(flag.section ?? '').trim()
  const at = String(flag.at ?? '').trim()
  if (!section || !at) return { ...profile, cantReachSection: null }
  if (!profile.assignedSection || section !== profile.assignedSection) {
    return { ...profile, cantReachSection: null }
  }
  return { ...profile, cantReachSection: { section, at } }
}

/** Clearing staff_called_* puts an open call back in the queue view. */
export function reopenCallQueueSql() {
  return `UPDATE signups SET payload = ?, staff_called_at = NULL, staff_called_by = NULL, updated_at = ? WHERE id = ? AND session_token = ?`
}

export function cantReachBadgeLabel(section: string) {
  const trimmed = section.trim()
  return trimmed ? `Не може да стигне до секцията (${trimmed})` : 'Не може да стигне до секцията'
}

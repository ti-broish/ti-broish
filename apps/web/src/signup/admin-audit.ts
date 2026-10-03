import { roleLabel } from './admin-progress'

export const AUDIT_FIELDS = ['role', 'days', 'staff_note'] as const
export type AuditField = (typeof AUDIT_FIELDS)[number]

export interface StaffSnapshot {
  role: string | null
  roundsFirst: boolean
  roundsRunoff: boolean
  staffNote: string
}

export interface AuditChange {
  field: AuditField
  before: string
  after: string
}

export interface AuditLine {
  id: string
  actor: string
  field: AuditField
  before: string
  after: string
  at: string
}

const NOTE_LIMIT = 280

export function daysText(first: boolean, runoff: boolean) {
  if (first && runoff) return '25 октомври и 1 ноември'
  if (first) return '25 октомври'
  if (runoff) return '1 ноември'
  return 'Без избран ден'
}

export function staffAuditChanges(before: StaffSnapshot, after: StaffSnapshot): AuditChange[] {
  const changes: AuditChange[] = []
  const roleBefore = roleLabel(before.role)
  const roleAfter = roleLabel(after.role)
  if (roleBefore !== roleAfter) changes.push({ field: 'role', before: roleBefore, after: roleAfter })
  const daysBefore = daysText(before.roundsFirst, before.roundsRunoff)
  const daysAfter = daysText(after.roundsFirst, after.roundsRunoff)
  if (daysBefore !== daysAfter) changes.push({ field: 'days', before: daysBefore, after: daysAfter })
  const noteBefore = noteText(before.staffNote)
  const noteAfter = noteText(after.staffNote)
  if (noteBefore !== noteAfter) changes.push({ field: 'staff_note', before: noteBefore, after: noteAfter })
  return changes
}

export function auditFieldLabel(field: string) {
  if (field === 'role') return 'Роля'
  if (field === 'days') return 'Дни'
  if (field === 'staff_note') return 'Бележка от екипа'
  return ''
}

export function describeAudit(field: string, before: string, after: string) {
  const label = auditFieldLabel(field)
  if (!label) return ''
  return `${label}: ${before} → ${after}`
}

export function formatAuditWhen(at: string) {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  return new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Sofia' }).format(date)
}

export function auditLines(
  rows: readonly { id: string; actor: string; field: string; before_text: string; after_text: string; created_at: string }[],
): AuditLine[] {
  return rows.flatMap((row) => {
    if (row.field !== 'role' && row.field !== 'days' && row.field !== 'staff_note') return []
    return [{ id: row.id, actor: row.actor, field: row.field, before: row.before_text, after: row.after_text, at: row.created_at }]
  })
}

function noteText(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return 'Празна бележка'
  if (trimmed.length <= NOTE_LIMIT) return trimmed
  return `${trimmed.slice(0, NOTE_LIMIT - 1)}…`
}

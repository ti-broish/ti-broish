import type { RikStatus } from './match'

/** Rows that hold no пълномощно for the РИК any more: an отписан/оттеглен person, or a duplicate number of the same ЕГН. */
export const RIK_HIDDEN_BY_DEFAULT: RikStatus[] = ['withdrawn', 'duplicate']

export const RIK_PROBLEM_STATUSES: RikStatus[] = ['stale', 'name_mismatch', 'number_mismatch', 'annulled', 'elsewhere', 'other_party', 'withdrawn_registered', 'rik_unavailable', 'renamed']

const quoted = (list: string[]) => list.map((item) => `'${item}'`).join(', ')

/**
 * True when the rik_status row `s` belongs to someone withdrawn right now: an отписан volunteer
 * (signups.withdrawn) or an оттеглено „И аз“ пълномощно (partner_people.withdrawn_at). Needs the
 * `su` / `pp` joins of RIK_LIVE_STATUS_SQL.
 */
export const RIK_LIVE_WITHDRAWN_SQL = `((s.source = 'signup' AND COALESCE(su.withdrawn, 0) = 1) OR (s.source = 'partner' AND pp.withdrawn_at IS NOT NULL))`

/**
 * rik_status as the admin sees it, with withdrawals applied at once. The hourly sync writes
 * rik_status; between runs a person withdrawn a minute ago would still read „Чака РИК“ and stay in
 * the lists. Here they read „Отписан“ straight away, or „За заличаване в РИК“ when the РИК already
 * published them (registered, or their name under another number); the next sync confirms it and adds the task.
 */
export const RIK_LIVE_STATUS_SQL = `SELECT s.person_id, s.source, s.mir, s.number, s.entry_id, s.other_mir, s.other_party, s.detail, s.status_since, s.checked_at,
  CASE WHEN ${RIK_LIVE_WITHDRAWN_SQL} AND s.status NOT IN ('withdrawn', 'withdrawn_registered')
    THEN CASE WHEN s.status IN ('registered', 'number_mismatch') OR (s.status = 'duplicate' AND s.entry_id IS NOT NULL) THEN 'withdrawn_registered' ELSE 'withdrawn' END
    ELSE s.status END AS status
FROM rik_status s
LEFT JOIN signups su ON s.source = 'signup' AND su.id = s.person_id
LEFT JOIN partner_people pp ON s.source = 'partner' AND pp.id = s.person_id`

/**
 * Open tasks the admin should still see: a withdrawn person keeps only „Махни човека“ (ask the РИК to
 * strike them); their „Обади се на РИК“ / „Поправи данните“ go away at once. Over rik_tasks `t`.
 */
export const RIK_TASK_VISIBLE_SQL = `(t.type = 'remove_person' OR t.person_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM rik_status s
  LEFT JOIN signups su ON s.source = 'signup' AND su.id = s.person_id
  LEFT JOIN partner_people pp ON s.source = 'partner' AND pp.id = s.person_id
  WHERE s.person_id = t.person_id AND ${RIK_LIVE_WITHDRAWN_SQL}))`

/**
 * WHERE parts for the /admin/rik „Хора“ list over rik_status `s`. With no status picked (all) the
 * list is the people the РИК should have, the same set the per-МИР counts show: withdrawn rows
 * (e.g. an „И аз“ пълномощно withdrawn because its ЕГН is a volunteer) and duplicates are left out.
 * They are still there when that status is picked on purpose.
 */
export function rikPeopleWhere(input: { mir: string; status: string }) {
  const where: string[] = []
  const binds: unknown[] = []
  if (input.mir) {
    where.push('s.mir = ?')
    binds.push(input.mir.padStart(2, '0'))
  }
  if (input.status === 'problems') where.push(`s.status IN (${quoted(RIK_PROBLEM_STATUSES)})`)
  else if (input.status) {
    where.push('s.status = ?')
    binds.push(input.status)
  } else where.push(`s.status NOT IN (${quoted(RIK_HIDDEN_BY_DEFAULT)})`)
  return { where, binds }
}

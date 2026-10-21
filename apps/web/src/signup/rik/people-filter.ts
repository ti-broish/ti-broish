import type { RikStatus } from './match'

/** Rows that hold no пълномощно for the РИК any more: an отписан/оттеглен person, or a duplicate number of the same ЕГН. */
export const RIK_HIDDEN_BY_DEFAULT: RikStatus[] = ['withdrawn', 'duplicate']

export const RIK_PROBLEM_STATUSES: RikStatus[] = ['stale', 'name_mismatch', 'number_mismatch', 'annulled', 'elsewhere', 'other_party', 'withdrawn_registered', 'rik_unavailable']

const quoted = (list: string[]) => list.map((item) => `'${item}'`).join(', ')

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

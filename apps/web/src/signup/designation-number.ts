/**
 * Пълномощно numbers run consecutively per МИР (the first two digits of the
 * section code) and start at 501 in each МИР. A number and its date are fixed
 * once assigned; gaps from deleted rows are not reused.
 */
export const DESIGNATION_NUMBER_START = 501

/** МИР code a number belongs to: the first two digits of the section code, or '' when unknown. */
export function designationMirOf(section: string) {
  const digits = section.replace(/\D/g, '')
  return digits.length >= 2 ? digits.slice(0, 2) : ''
}

/** Next number after the stored ones in one МИР; 501 for a МИР with none. */
export function nextDesignationNumber(existing: Array<number | null | undefined>) {
  let max = DESIGNATION_NUMBER_START - 1
  for (const value of existing) {
    if (typeof value === 'number' && Number.isFinite(value) && value > max) max = value
  }
  return max + 1
}

export function parseStoredNumber(value: string | number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  if (typeof value !== 'string') return null
  const match = value.trim().match(/(\d+)\s*$/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** `501/19.10.2026`: number, slash, date, no spaces and no „г.“. */
export function formatNumberWithDate(number: string | number, issuedOn: string) {
  return `${String(number).trim()}/${issuedOn.trim()}`
}

export interface DesignationNumberPlanRow {
  id: string
  publishedSection: string
  createdAt: string
  number: number | null
  issuedAt: string | null
  /** МИР stored with the number; for a numbered row it wins over the section. */
  mir?: string | null
}

export interface DesignationNumberUpdate {
  id: string
  mir: string
  number: number
  issuedAt: string
  assigned: boolean
}

function orderForNumbering<T extends DesignationNumberPlanRow>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const section = a.publishedSection.localeCompare(b.publishedSection)
    if (section) return section
    const created = a.createdAt.localeCompare(b.createdAt)
    if (created) return created
    return a.id.localeCompare(b.id)
  })
}

function rowMir(row: DesignationNumberPlanRow) {
  return (row.number != null && row.mir?.trim()) || designationMirOf(row.publishedSection)
}

/**
 * In-memory plan: per-МИР MAX+1 from 501, in published_section, created_at, id
 * order. Never renumbers. `existingMax` holds the stored maximum per МИР.
 * The Worker assigns with designationAssignSql instead, which is atomic in D1;
 * this plan serves the CLI and the tests.
 */
export function planDesignationNumbering(
  rows: DesignationNumberPlanRow[],
  existingMax: ReadonlyMap<string, number> | Record<string, number>,
  issuedOn: string,
): { updates: DesignationNumberUpdate[]; assigned: number } {
  const maxOf = (mir: string) =>
    existingMax instanceof Map ? existingMax.get(mir) : (existingMax as Record<string, number>)[mir]
  const next = new Map<string, number>()
  const ordered = orderForNumbering(rows)
  for (const row of ordered) {
    const mir = rowMir(row)
    const current = next.get(mir) ?? nextDesignationNumber([maxOf(mir)])
    const stored = parseStoredNumber(row.number)
    next.set(mir, stored != null && stored >= current ? stored + 1 : current)
  }
  const updates: DesignationNumberUpdate[] = []
  for (const row of ordered) {
    const mir = rowMir(row)
    if (!mir) continue
    const existing = parseStoredNumber(row.number)
    const assigned = existing == null
    let number = existing ?? 0
    if (assigned) {
      number = next.get(mir) ?? DESIGNATION_NUMBER_START
      next.set(mir, number + 1)
    }
    const storedDate = (row.issuedAt ?? '').trim()
    if (!assigned && storedDate) continue
    updates.push({ id: row.id, mir, number, issuedAt: storedDate || issuedOn, assigned })
  }
  return { updates, assigned: updates.filter((row) => row.assigned).length }
}

/**
 * Next number in МИР ?1 across both tables that hold пълномощни: signups and
 * partner_people („И аз“). One counter per МИР, so numbers never collide.
 */
const NEXT_IN_MIR_SQL = `MAX(
    COALESCE((SELECT MAX(designation_number) FROM signups WHERE designation_mir = ?1), ${DESIGNATION_NUMBER_START - 1}),
    COALESCE((SELECT MAX(designation_number) FROM partner_people WHERE designation_mir = ?1), ${DESIGNATION_NUMBER_START - 1}),
    ${DESIGNATION_NUMBER_START - 1}) + 1`

/**
 * Assigns the next number in the person's МИР in one statement, so concurrent
 * or bulk runs cannot hand out the same number (D1 runs each statement
 * atomically; the unique index on (designation_mir, designation_number) is the
 * backstop). Binds: ?1 МИР, ?2 issued date (dd.mm.yyyy, Sofia), ?3 updated_at, ?4 id.
 * Does nothing for a person who already has a number.
 */
export const DESIGNATION_ASSIGN_SQL = `UPDATE signups SET
  designation_mir = ?1,
  designation_number = ${NEXT_IN_MIR_SQL},
  designation_issued_at = ?2,
  updated_at = ?3
  WHERE id = ?4 AND designation_number IS NULL`

/**
 * Same counter for a partner person („И аз“). Their МИР is set on import (or by
 * staff) and is fixed once numbered. Binds as DESIGNATION_ASSIGN_SQL.
 */
export const PARTNER_DESIGNATION_ASSIGN_SQL = `UPDATE partner_people SET
  designation_number = ${NEXT_IN_MIR_SQL},
  designation_issued_at = ?2,
  updated_at = ?3
  WHERE id = ?4 AND designation_number IS NULL AND designation_mir = ?1`

/** One number per МИР: numbers restart at 501 in every МИР. */
export const DESIGNATION_NUMBER_UNIQUE_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_signups_designation_mir_number ON signups(designation_mir, designation_number) WHERE designation_number IS NOT NULL'

/** Stored maximum per МИР across signups and partner people, for the CLI plan. */
export const DESIGNATION_MAX_PER_MIR_SQL = `SELECT mir, MAX(n) AS n FROM (
  SELECT designation_mir AS mir, designation_number AS n FROM signups
    WHERE designation_number IS NOT NULL AND COALESCE(designation_mir, '') != ''
  UNION ALL
  SELECT designation_mir AS mir, designation_number AS n FROM partner_people
    WHERE designation_number IS NOT NULL AND COALESCE(designation_mir, '') != ''
) GROUP BY mir`

export function maxPerMirFromRows(rows: Array<{ mir: string | null; n: number | string | null }>) {
  const map = new Map<string, number>()
  for (const row of rows) {
    const mir = (row.mir ?? '').trim()
    const n = parseStoredNumber(row.n)
    if (mir && n != null) map.set(mir, n)
  }
  return map
}

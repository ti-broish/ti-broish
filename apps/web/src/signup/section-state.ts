/**
 * Секции: every finished signup is in exactly one of three states.
 * - none: no draft and no published section
 * - draft: a draft section, nothing published yet (only the admins see it)
 * - published: a published section (the person sees it in /profil). A published person can also
 *   carry a different pending draft (a change); they still count as published until it is published.
 */
export const SECTION_STATES = ['none', 'draft', 'published'] as const
export type SectionState = (typeof SECTION_STATES)[number]

export const SECTION_STATE_LABELS: Record<SectionState, string> = {
  none: 'Без секция',
  draft: 'Чернова',
  published: 'Публикувани',
}

const PUBLISHED = `COALESCE(published_section, '') != ''`
const DRAFTED = `COALESCE(draft_section, '') != ''`

export const SECTION_STATE_SQL: Record<SectionState, string> = {
  none: `NOT (${PUBLISHED}) AND NOT (${DRAFTED})`,
  draft: `NOT (${PUBLISHED}) AND ${DRAFTED}`,
  published: PUBLISHED,
}

export function isSectionState(value: unknown): value is SectionState {
  return typeof value === 'string' && (SECTION_STATES as readonly string[]).includes(value)
}

export function sectionStateOf(person: { draftSection: string; publishedSection: string }): SectionState {
  if (person.publishedSection.trim()) return 'published'
  if (person.draftSection.trim()) return 'draft'
  return 'none'
}

/** A draft that publishing would show: no published section yet, or a change to the published one. */
export function hasPendingDraft(person: { draftSection: string; publishedSection: string }) {
  const draft = person.draftSection.trim()
  return Boolean(draft && draft !== person.publishedSection.trim())
}

/** Counts per state over an already filtered set of signups (one row, SUMs). */
export function sectionCountsSql(clause: string) {
  return `SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN ${SECTION_STATE_SQL.none} THEN 1 ELSE 0 END), 0) AS none,
    COALESCE(SUM(CASE WHEN ${SECTION_STATE_SQL.draft} THEN 1 ELSE 0 END), 0) AS draft,
    COALESCE(SUM(CASE WHEN ${SECTION_STATE_SQL.published} THEN 1 ELSE 0 END), 0) AS published
  FROM signups WHERE ${clause}`
}

export type SectionCounts = { total: number; none: number; draft: number; published: number }

export function sectionCountsFrom(row: Partial<Record<keyof SectionCounts, unknown>> | null | undefined): SectionCounts {
  return {
    total: Number(row?.total ?? 0),
    none: Number(row?.none ?? 0),
    draft: Number(row?.draft ?? 0),
    published: Number(row?.published ?? 0),
  }
}

export const MAX_PICKED = 500

/** Clean list of picked signup ids: strings only, trimmed, unique, at most MAX_PICKED. */
export function pickedIds(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  for (const value of input) {
    if (typeof value !== 'string') continue
    const id = value.trim().slice(0, 64)
    if (id) seen.add(id)
    if (seen.size >= MAX_PICKED) break
  }
  return [...seen]
}

/**
 * Narrows a roster filter to picked ids. One JSON bind instead of one bind per id, so a large
 * pick stays under D1's 100 bound parameters. `undefined` ids leave the filter as it is.
 */
export function withPickedIds<T extends { clause: string; binds: unknown[] } | { error: string }>(filter: T, ids: unknown): T {
  if (ids === undefined || 'error' in filter) return filter
  const picked = pickedIds(ids)
  return {
    ...filter,
    clause: `(${filter.clause}) AND id IN (SELECT value FROM json_each(?))`,
    binds: [...filter.binds, JSON.stringify(picked)],
  }
}

/**
 * „Махни публикуването“: the person stops seeing the section; it stays as a manual (locked)
 * draft so an auto-allocation rerun keeps it and nobody else gets it. A pending change stays the
 * draft. draft_section is only written when it is empty, so the reservation triggers never fire
 * on an untouched draft. Binds: updated_at, id.
 */
export function unpublishSql(draftEmpty: boolean) {
  return `UPDATE signups SET
    ${draftEmpty ? 'draft_section = published_section,' : ''}
    draft_locked = 1,
    published_section = NULL,
    published_at = NULL,
    updated_at = ?
  WHERE id = ? AND COALESCE(published_section, '') != ''`
}

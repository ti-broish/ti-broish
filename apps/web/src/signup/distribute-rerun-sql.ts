/**
 * What „Направи чернови за страната“ writes. Both statements only ever touch rows with no
 * published section and an unlocked (automatic) draft: a published section, a manual draft
 * (saved with „Запази“ or left by „Махни публикуването“) and a withdrawn person are
 * never written. The caller (admin-distribute.ts) skips codes in taken_sections (reservedMap) before
 * writing, and the reservation triggers are the last word.
 */

/**
 * Full rerun, step 1: drop the country allocator's automatic drafts so they are planned again.
 * Abroad drafts belong to the abroad allocator, which the country plan skips, so they stay.
 * Binds: updated_at.
 */
export const RERUN_CLEAR_AUTO_DRAFTS_SQL = `UPDATE signups
  SET draft_section = NULL, updated_at = ?
  WHERE COALESCE(published_section, '') = ''
    AND COALESCE(draft_locked, 0) = 0
    AND COALESCE(draft_section, '') != ''
    AND COALESCE(submitted, 0) = 1
    AND COALESCE(withdrawn, 0) = 0
    AND COALESCE(region_code, '') != '32'
    AND COALESCE(mir_code, '') != '32'`

/**
 * „Изчисти черновите“: only the allocators' own drafts (automatic, draft_locked = 0, on someone
 * with no published section), in the country and abroad. Manual drafts and published rows stay.
 */
export const AUTO_DRAFT_WHERE = `COALESCE(draft_section, '') != ''
    AND COALESCE(draft_locked, 0) = 0
    AND COALESCE(published_section, '') = ''`

/** Binds: updated_at. */
export const CLEAR_AUTO_DRAFTS_SQL = `UPDATE signups SET draft_section = NULL, updated_at = ? WHERE ${AUTO_DRAFT_WHERE}`

/**
 * Step 2, per planned person: write an automatic draft. Section volunteers first, then mobile-team
 * volunteers (they need a section for the пълномощно). With onlyEmpty = 1 an existing draft of
 * any kind stays. Binds: section, updated_at, id, onlyEmpty (0 | 1).
 */
export const RERUN_WRITE_DRAFT_SQL = `UPDATE signups
  SET draft_section = ?, draft_locked = 0, updated_at = ?
  WHERE id = ?
    AND COALESCE(published_section, '') = ''
    AND COALESCE(draft_locked, 0) = 0
    AND COALESCE(submitted, 0) = 1
    AND COALESCE(withdrawn, 0) = 0
    AND COALESCE(role, '') IN ('section', 'mobile')
    AND (? = 0 OR COALESCE(draft_section, '') = '')`

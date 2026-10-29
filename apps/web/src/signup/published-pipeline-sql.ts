/**
 * SQL for „публикувана секция → напред“ (published-pipeline.ts). Client-safe, no Worker imports.
 *
 * Someone who gets a published section is moved forward at once: numbered (пълномощно), so the next
 * „Само новите“ ZIP for signing holds them, and (volunteers only) upserted as a Brevo contact with
 * the section attributes. „И аз“ people are numbered but never go to our Brevo.
 */

/** Added at runtime by db-core and in sql/2026-10-29-brevo-section-synced.sql. */
export const BREVO_SECTION_SYNC_COLUMNS = [
  'ALTER TABLE signups ADD COLUMN brevo_section_synced TEXT',
  'ALTER TABLE signups ADD COLUMN brevo_section_synced_at TEXT',
]

/**
 * What the Brevo contact was last synced for: the published section and when it was published.
 * A new publish (even of the same code) changes published_at, so the contact is sent again.
 */
export const BREVO_SECTION_KEY_SQL = `COALESCE(published_section, '') || '@' || COALESCE(published_at, '')`

/** Placeholder addresses (…@tibroish.invalid) are never Brevo contacts (designation-section-sql.ts). */
const REAL_EMAIL_SQL = `COALESCE(TRIM(email), '') != '' AND LOWER(TRIM(email)) NOT LIKE '%@tibroish.invalid'`

/** Active volunteers with a published section whose Brevo contact is not synced for it yet. */
export const BREVO_SECTION_PENDING_WHERE = `COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0
  AND ${REAL_EMAIL_SQL}
  AND COALESCE(brevo_section_synced, '') != ${BREVO_SECTION_KEY_SQL}`

/** Mark one contact synced, only if the section did not change while Brevo answered. Binds: ?1 key, ?2 at, ?3 id. */
export const BREVO_SECTION_MARK_SQL = `UPDATE signups SET brevo_section_synced = ?1, brevo_section_synced_at = ?2
  WHERE id = ?3 AND ${BREVO_SECTION_KEY_SQL} = ?1`

/**
 * An unnumbered „И аз“ person with a published section is numbered in that section's МИР: a number
 * must match the section (designation-mir-guard.ts). Numbered people keep their МИР. Binds: ?1 updated_at.
 * Scoped by `idsJson` (json array) when given.
 */
export function partnerMirFromSectionSql(scoped: boolean) {
  return `UPDATE partner_people SET designation_mir = substr(section_published, 1, 2), updated_at = ?1
  WHERE designation_number IS NULL AND withdrawn_at IS NULL
    AND length(COALESCE(section_published, '')) = 9
    AND COALESCE(designation_mir, '') != substr(section_published, 1, 2)
    ${scoped ? 'AND id IN (SELECT value FROM json_each(?2))' : ''}`
}

/** Counts for the report and the admin line: how far people with a published section are. */
export const PIPELINE_COUNTS_SQL = `SELECT
  (SELECT COUNT(*) FROM signups WHERE COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0) AS volunteers,
  (SELECT COUNT(*) FROM signups WHERE COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0 AND designation_number IS NULL) AS volunteers_unnumbered,
  (SELECT COUNT(*) FROM signups WHERE COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0 AND designation_number IS NOT NULL
     AND designation_signed_at IS NULL AND designation_signing_generated_at IS NULL) AS volunteers_to_sign,
  (SELECT COUNT(*) FROM signups WHERE COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0 AND ${REAL_EMAIL_SQL}) AS volunteers_brevo,
  (SELECT COUNT(*) FROM signups WHERE ${BREVO_SECTION_PENDING_WHERE}) AS volunteers_brevo_pending,
  (SELECT COUNT(*) FROM partner_people WHERE COALESCE(section_published, '') != '' AND withdrawn_at IS NULL) AS partners,
  (SELECT COUNT(*) FROM partner_people WHERE COALESCE(section_published, '') != '' AND withdrawn_at IS NULL AND designation_number IS NULL) AS partners_unnumbered,
  (SELECT COUNT(*) FROM partner_people WHERE COALESCE(section_published, '') != '' AND withdrawn_at IS NULL AND designation_number IS NOT NULL
     AND designation_signed_at IS NULL AND designation_signing_generated_at IS NULL) AS partners_to_sign`

export type PipelineCounts = {
  volunteers: number
  volunteersUnnumbered: number
  volunteersToSign: number
  volunteersBrevo: number
  volunteersBrevoPending: number
  partners: number
  partnersUnnumbered: number
  partnersToSign: number
}

export function pipelineCountsFrom(row: Record<string, unknown> | null | undefined): PipelineCounts {
  const n = (key: string) => Number(row?.[key] ?? 0) || 0
  return {
    volunteers: n('volunteers'),
    volunteersUnnumbered: n('volunteers_unnumbered'),
    volunteersToSign: n('volunteers_to_sign'),
    volunteersBrevo: n('volunteers_brevo'),
    volunteersBrevoPending: n('volunteers_brevo_pending'),
    partners: n('partners'),
    partnersUnnumbered: n('partners_unnumbered'),
    partnersToSign: n('partners_to_sign'),
  }
}

export type AdvanceReport = {
  /** Got a number in this run (volunteers and „И аз“). */
  numbered: number
  numberedPartners: number
  /** Same ЕГН already holds a number; not numbered (one person, one пълномощно). */
  skippedDuplicates: number
  /** „И аз“ covered by an active volunteer with the same ЕГН. */
  skippedCovered: number
  /** Unnumbered „И аз“ whose МИР was set from the published section. */
  partnersMirSet: number
  brevo: { synced: number; created: number; failed: number; left: number; skipped?: string; firstError?: string }
  counts: PipelineCounts
}

/** One line for the admin after a publish or „Придвижи публикуваните“. */
export function describeAdvance(report: AdvanceReport | { error: string } | null | undefined) {
  if (!report) return ''
  if ('error' in report) return report.error ? ` Номерирането/Brevo не мина (${report.error}); ще се опита пак до час.` : ''
  const parts = [`Номерирани ${report.numbered}${report.numberedPartners ? ` (от тях „И аз“ ${report.numberedPartners})` : ''}`]
  if (report.skippedDuplicates) parts.push(`с ЕГН, което вече има номер: ${report.skippedDuplicates}`)
  const toSign = report.counts.volunteersToSign + report.counts.partnersToSign
  parts.push(`за подпис („Само новите“): ${toSign}`)
  const b = report.brevo
  if (b.skipped) parts.push(`Brevo: не е пратено (${b.skipped})`)
  else if (b.synced || b.failed) parts.push(`Brevo контакти: ${b.synced}${b.failed ? `, грешки ${b.failed}${b.firstError ? ` (${b.firstError})` : ''}` : ''}${b.left ? `, остават ${b.left} за следващото пускане` : ''}`)
  return ` Напред: ${parts.join('; ')}. Без писма.`
}

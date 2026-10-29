/**
 * SQL for „публикувана секция → напред“ (published-pipeline.ts). Client-safe, no Worker imports.
 *
 * Someone who gets a published section is moved forward at once: numbered (пълномощно), so the next
 * „Само новите“ ZIP for signing holds them, and (volunteers only) upserted as a Brevo contact with
 * the section attributes. „И аз“ people are numbered but never go to our Brevo.
 */

import { egnHeldSql, partnerDuplicateSql, signupDuplicateSql } from './designation-duplicates'
import { SIGNUP_DESIGNATION_SECTION_SQL } from './designation-section-sql'
import { realEmailSql } from './no-email'

const SIGNUP_SECTION_MIR = `substr(COALESCE(published_section, ''), 1, 2)`
const PARTNER_SECTION_MIR = `substr(COALESCE(section_published, ''), 1, 2)`

/**
 * Unnumbered, with a published section, and the same ЕГН holds a number in that section's МИР: the
 * пълномощно is valid for the whole МИР, so this person is covered (counts as numbered, gets the
 * Brevo section sync, never a second number). Outer table: signups.
 */
export const SIGNUP_COVERED_SAME_MIR_SQL = `(designation_number IS NULL AND ${egnHeldSql('signups', 'signups', SIGNUP_SECTION_MIR, true)})`

/**
 * Unnumbered, and the same ЕГН holds a number only in a DIFFERENT МИР than the published section:
 * the real conflict. Never numbered, not „без номер“, not sent to Brevo with this section. Outer: signups.
 */
export const SIGNUP_HELD_ELSEWHERE_SQL = `(designation_number IS NULL AND NOT ${egnHeldSql('signups', 'signups', SIGNUP_SECTION_MIR, true)}
  AND ${egnHeldSql('signups', 'signups', SIGNUP_SECTION_MIR, false)})`

/** Unnumbered „И аз“ covered in the same МИР by the number its ЕГН holds elsewhere, or by a volunteer (covered_by). Outer: partner_people. */
export const PARTNER_COVERED_SQL = `(designation_number IS NULL AND (${egnHeldSql('partner_people', 'partner_people', PARTNER_SECTION_MIR, true)}
  OR EXISTS (SELECT 1 FROM signups c WHERE c.id = partner_people.covered_by_signup_id AND COALESCE(c.withdrawn, 0) = 0)))`

/** Unnumbered „И аз“ whose ЕГН holds a number only in another МИР. Outer: partner_people. */
export const PARTNER_HELD_ELSEWHERE_SQL = `(designation_number IS NULL AND NOT ${PARTNER_COVERED_SQL}
  AND ${egnHeldSql('partner_people', 'partner_people', PARTNER_SECTION_MIR, false)})`

/** The signing ZIP's own set („/admin/designation-zip“): numbered, active, not a duplicate, with or without a section. */
const SIGNUP_ZIP_SET = `${SIGNUP_DESIGNATION_SECTION_SQL} != '' AND designation_number IS NOT NULL AND COALESCE(withdrawn, 0) = 0 AND NOT ${signupDuplicateSql('signups')}`
const PARTNER_ZIP_SET = `COALESCE(designation_mir, '') != '' AND designation_number IS NOT NULL AND withdrawn_at IS NULL AND NOT ${partnerDuplicateSql('partner_people')}`
const NEW_SCOPE = 'designation_signed_at IS NULL AND designation_signing_generated_at IS NULL'

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

/** No e-mail (empty or the …@tibroish.invalid stand-in): never a Brevo contact, never pending (no-email.ts). */
const REAL_EMAIL_SQL = realEmailSql('email')

/** Active volunteers with a published section whose Brevo contact is not synced for it yet. */
export const BREVO_SECTION_PENDING_WHERE = `COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0
  AND ${REAL_EMAIL_SQL}
  AND NOT ${SIGNUP_HELD_ELSEWHERE_SQL}
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
  (SELECT COUNT(*) FROM signups WHERE COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0 AND designation_number IS NULL
     AND NOT ${SIGNUP_COVERED_SAME_MIR_SQL} AND NOT ${SIGNUP_HELD_ELSEWHERE_SQL}) AS volunteers_unnumbered,
  (SELECT COUNT(*) FROM signups WHERE COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0 AND ${SIGNUP_COVERED_SAME_MIR_SQL}) AS volunteers_covered,
  (SELECT COUNT(*) FROM signups WHERE COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0 AND ${SIGNUP_HELD_ELSEWHERE_SQL}) AS volunteers_held_elsewhere,
  (SELECT COUNT(*) FROM signups WHERE ${SIGNUP_ZIP_SET}) AS volunteers_numbered,
  (SELECT COUNT(*) FROM signups WHERE ${SIGNUP_ZIP_SET} AND COALESCE(published_section, '') = '') AS volunteers_numbered_no_section,
  (SELECT COUNT(*) FROM signups WHERE ${SIGNUP_ZIP_SET} AND ${NEW_SCOPE}) AS volunteers_to_sign,
  (SELECT COUNT(*) FROM signups WHERE COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0 AND ${REAL_EMAIL_SQL}
     AND NOT ${SIGNUP_HELD_ELSEWHERE_SQL}) AS volunteers_brevo,
  (SELECT COUNT(*) FROM signups WHERE ${BREVO_SECTION_PENDING_WHERE}) AS volunteers_brevo_pending,
  (SELECT COUNT(*) FROM partner_people WHERE COALESCE(section_published, '') != '' AND withdrawn_at IS NULL) AS partners,
  (SELECT COUNT(*) FROM partner_people WHERE COALESCE(section_published, '') != '' AND withdrawn_at IS NULL AND designation_number IS NULL
     AND NOT ${PARTNER_COVERED_SQL} AND NOT ${PARTNER_HELD_ELSEWHERE_SQL}) AS partners_unnumbered,
  (SELECT COUNT(*) FROM partner_people WHERE COALESCE(section_published, '') != '' AND withdrawn_at IS NULL AND ${PARTNER_HELD_ELSEWHERE_SQL}) AS partners_held_elsewhere,
  (SELECT COUNT(*) FROM partner_people WHERE ${PARTNER_ZIP_SET}) AS partners_numbered,
  (SELECT COUNT(*) FROM partner_people WHERE ${PARTNER_ZIP_SET} AND COALESCE(section_published, '') = '') AS partners_numbered_no_section,
  (SELECT COUNT(*) FROM partner_people WHERE ${PARTNER_ZIP_SET} AND ${NEW_SCOPE}) AS partners_to_sign`

export type PipelineCounts = {
  volunteers: number
  /** Unnumbered and their ЕГН holds no number elsewhere: really waiting for one. */
  volunteersUnnumbered: number
  /** Unnumbered, covered by the number their ЕГН holds in the same МИР (valid there): counts as numbered. */
  volunteersCovered: number
  /** Unnumbered because the same ЕГН holds a number only in another МИР (the real conflict). */
  volunteersHeldElsewhere: number
  /** In the signing ZIP set (numbered, active, not a duplicate), with or without a section. */
  volunteersNumbered: number
  volunteersNumberedNoSection: number
  volunteersToSign: number
  volunteersBrevo: number
  volunteersBrevoPending: number
  partners: number
  partnersUnnumbered: number
  partnersHeldElsewhere: number
  partnersNumbered: number
  partnersNumberedNoSection: number
  partnersToSign: number
}

export function pipelineCountsFrom(row: Record<string, unknown> | null | undefined): PipelineCounts {
  const n = (key: string) => Number(row?.[key] ?? 0) || 0
  return {
    volunteers: n('volunteers'),
    volunteersUnnumbered: n('volunteers_unnumbered'),
    volunteersCovered: n('volunteers_covered'),
    volunteersHeldElsewhere: n('volunteers_held_elsewhere'),
    volunteersNumbered: n('volunteers_numbered'),
    volunteersNumberedNoSection: n('volunteers_numbered_no_section'),
    volunteersToSign: n('volunteers_to_sign'),
    volunteersBrevo: n('volunteers_brevo'),
    volunteersBrevoPending: n('volunteers_brevo_pending'),
    partners: n('partners'),
    partnersUnnumbered: n('partners_unnumbered'),
    partnersHeldElsewhere: n('partners_held_elsewhere'),
    partnersNumbered: n('partners_numbered'),
    partnersNumberedNoSection: n('partners_numbered_no_section'),
    partnersToSign: n('partners_to_sign'),
  }
}

export type AdvanceReport = {
  /** Got a number in this run (volunteers and „И аз“). */
  numbered: number
  numberedPartners: number
  /** Volunteers without an e-mail numbered by МИР alone (no section needed). */
  numberedNoEmail?: number
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
  const parts = [`Номерирани ${report.numbered}${report.numberedPartners ? ` (от тях „И аз“ ${report.numberedPartners})` : ''}${report.numberedNoEmail ? ` (без имейл, по МИР: ${report.numberedNoEmail})` : ''}`]
  if (report.skippedDuplicates) parts.push(`с ЕГН, което вече има номер: ${report.skippedDuplicates}`)
  const toSign = report.counts.volunteersToSign + report.counts.partnersToSign
  parts.push(`за подпис („Само новите“): ${toSign}`)
  const b = report.brevo
  if (b.skipped) parts.push(`Brevo: не е пратено (${b.skipped})`)
  else if (b.synced || b.failed) parts.push(`Brevo контакти: ${b.synced}${b.failed ? `, грешки ${b.failed}${b.firstError ? ` (${b.firstError})` : ''}` : ''}${b.left ? `, остават ${b.left} за следващото пускане` : ''}`)
  return ` Напред: ${parts.join('; ')}. Без писма.`
}

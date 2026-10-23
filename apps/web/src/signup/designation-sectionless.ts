/**
 * Finished volunteers without a published section still get a пълномощно: the document names only
 * the МИР (as for „И аз“), so „Номерирай“ numbers them in a МИР from their draft section or their
 * home place (signups.mir_code). София без район (sofia-merged, 23/24/25) is ambiguous: such a
 * volunteer stays unnumbered and is listed on /admin/palnomoshtni as „без МИР – избери“ until staff
 * set the район on the profile. Once numbered, SIGNUP_DESIGNATION_SECTION_SQL lists them by МИР,
 * so the PDF, the ZIP and the uploads work without a section. Client-safe: SQL strings and pure helpers.
 */
import { ELECTION_DISTRICTS } from './designation-config'
import { egnKeySql } from './designation-duplicates'
import { designationMirOf } from './designation-number'
import { MERGED_SIGNUP_SQL } from './partner-roster'

/** Submitted, active, unnumbered volunteers with no published section (merged ones excluded: their „И аз“ row stands). */
export const SECTIONLESS_SIGNUPS_SQL = `SELECT id,
  COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
  COALESCE(json_extract(payload, '$.middleName'), '') AS middle_name,
  COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
  COALESCE(email, '') AS email,
  COALESCE(draft_section, '') AS draft_section,
  COALESCE(mir_code, '') AS mir_code,
  COALESCE(region_code, '') AS region_code,
  created_at,
  ${egnKeySql('egn')} AS egn_key
  FROM signups
  WHERE COALESCE(withdrawn, 0) = 0 AND COALESCE(submitted, 0) = 1 AND designation_number IS NULL
    AND COALESCE(published_section, '') = ''
    AND NOT ${MERGED_SIGNUP_SQL}`

export interface SectionlessRow {
  draft_section?: string | null
  mir_code?: string | null
  region_code?: string | null
}

export type SectionlessMir = { mir: string; reason: null } | { mir: ''; reason: string }

export const SOFIA_NO_DISTRICT_REASON = 'София без район (23/24/25)'
export const NO_MIR_REASON = 'няма МИР в профила'

/** МИР for the пълномощно of a volunteer without a published section: draft section, else home place. */
export function sectionlessMir(row: SectionlessRow): SectionlessMir {
  const draft = designationMirOf(String(row.draft_section ?? ''))
  if (draft && ELECTION_DISTRICTS[draft]) return { mir: draft, reason: null }
  const home = String(row.mir_code ?? '').trim()
  const code = /^\d{1,2}$/.test(home) ? home.padStart(2, '0') : ''
  if (code && ELECTION_DISTRICTS[code]) return { mir: code, reason: null }
  if (String(row.region_code ?? '').trim() === 'sofia-merged') return { mir: '', reason: SOFIA_NO_DISTRICT_REASON }
  return { mir: '', reason: NO_MIR_REASON }
}

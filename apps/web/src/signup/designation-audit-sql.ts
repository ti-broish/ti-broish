/**
 * Audit lines for пълномощни, in signup_audit (signup_id holds a signup id or a „И аз“ pp- id).
 * Numbers never change, so a person gets at most one 'designation_number' line.
 */

/**
 * After an assign UPDATE in the same batch: one line when the row was just numbered by this run.
 * Binds: ?1 audit id, ?2 actor, ?3 updated_at of the run, ?4 person id.
 */
export const designationNumberAuditSql = (table: 'signups' | 'partner_people') => `INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at)
  SELECT ?1, id, ?2, 'designation_number', '', designation_mir || '/' || designation_number || ' от ' || COALESCE(designation_issued_at, ''), ?3
  FROM ${table}
  WHERE id = ?4 AND designation_number IS NOT NULL AND updated_at = ?3
    AND NOT EXISTS (SELECT 1 FROM signup_audit a WHERE a.signup_id = ?4 AND a.field = 'designation_number')`

/**
 * Withdraw one „И аз“ пълномощно. Number and МИР stay (history; numbers are never reused).
 * Binds: ?1 withdrawn_at, ?2 actor, ?3 reason, ?4 id.
 */
export const PARTNER_WITHDRAW_SQL = `UPDATE partner_people SET withdrawn_at = ?1, withdrawn_by = ?2, withdrawn_reason = ?3, updated_at = ?1
  WHERE id = ?4 AND withdrawn_at IS NULL`

/** The audit line for that withdrawal, written only when this call withdrew it. Binds: ?1 audit id, ?2 actor, ?3 at, ?4 id. */
export const PARTNER_WITHDRAW_AUDIT_SQL = `INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at)
  SELECT ?1, id, ?2, 'partner_withdrawn',
    'активно' || CASE WHEN designation_number IS NOT NULL THEN ' № ' || COALESCE(designation_mir, '') || '/' || designation_number ELSE '' END,
    'оттеглено: ' || COALESCE(withdrawn_reason, ''), ?3
  FROM partner_people WHERE id = ?4 AND withdrawn_at = ?3 AND withdrawn_by = ?2`

export const PARTNER_WITHDRAW_REASON_MAX = 300

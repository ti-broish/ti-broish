/**
 * SET clause for a signed upload (binds one timestamp): the first upload fixes the wave;
 * a replacement keeps it. Rows signed before this column fall back to designation_signed_at.
 */
export const SIGNED_WAVE_SET_SQL = 'designation_first_signed_at = COALESCE(designation_first_signed_at, designation_signed_at, ?)'

/** Added at runtime by db-core and in sql/2026-10-20-signed-waves.sql. */
export const SIGNED_WAVE_COLUMNS = [
  'ALTER TABLE signups ADD COLUMN designation_first_signed_at TEXT',
  'ALTER TABLE partner_people ADD COLUMN designation_first_signed_at TEXT',
]

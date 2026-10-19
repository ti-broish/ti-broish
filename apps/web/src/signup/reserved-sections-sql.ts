/**
 * Database backstop for reserved sections (rows in taken_sections): no path may write a reserved
 * code into a draft or a published section. A row that already holds one keeps it (a conflict to
 * reassign), and clearing a draft back to the published section stays allowed.
 */
export const RESERVED_SECTION_GUARDS = [
  'CREATE INDEX IF NOT EXISTS idx_taken_org ON taken_sections(organisation)',
  `CREATE TRIGGER IF NOT EXISTS trg_signups_reserved_draft_update
BEFORE UPDATE OF draft_section ON signups
WHEN COALESCE(NEW.draft_section, '') != ''
  AND NEW.draft_section IS NOT OLD.draft_section
  AND NEW.draft_section IS NOT OLD.published_section
  AND EXISTS (SELECT 1 FROM taken_sections WHERE section_code = NEW.draft_section)
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_signups_reserved_published_update
BEFORE UPDATE OF published_section ON signups
WHEN COALESCE(NEW.published_section, '') != ''
  AND NEW.published_section IS NOT OLD.published_section
  AND EXISTS (SELECT 1 FROM taken_sections WHERE section_code = NEW.published_section)
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_signups_reserved_insert
BEFORE INSERT ON signups
WHEN EXISTS (SELECT 1 FROM taken_sections WHERE section_code IN (COALESCE(NEW.draft_section, ''), COALESCE(NEW.published_section, '')))
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END`,
]

export function isReservedAbort(error: unknown) {
  return /reserved_section/.test(error instanceof Error ? error.message : String(error))
}

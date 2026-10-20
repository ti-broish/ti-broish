-- „И аз“ partner sections (PR: partner people get sections, reserved as „И аз“ on publish).
-- Also applied at runtime by db-core signupDatabase(). Run once per database, before the code ships.
-- Adds draft/published section columns to partner_people and the one-quota-per-section triggers.
ALTER TABLE partner_people ADD COLUMN section_draft TEXT;
ALTER TABLE partner_people ADD COLUMN section_draft_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner_people ADD COLUMN section_draft_source TEXT;
ALTER TABLE partner_people ADD COLUMN section_drafted_at TEXT;
ALTER TABLE partner_people ADD COLUMN section_published TEXT;
ALTER TABLE partner_people ADD COLUMN section_published_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_people_section_draft ON partner_people(section_draft) WHERE section_draft IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_people_section_published ON partner_people(section_published) WHERE section_published IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS trg_partner_section_draft_update
BEFORE UPDATE OF section_draft ON partner_people
WHEN COALESCE(NEW.section_draft, '') != ''
  AND NEW.section_draft IS NOT OLD.section_draft
  AND NEW.section_draft IS NOT OLD.section_published
  AND (EXISTS (SELECT 1 FROM taken_sections WHERE section_code = NEW.section_draft)
    OR EXISTS (SELECT 1 FROM signups WHERE COALESCE(withdrawn, 0) = 0 AND (draft_section = NEW.section_draft OR published_section = NEW.section_draft))
    OR EXISTS (SELECT 1 FROM partner_people p WHERE p.id != NEW.id AND (p.section_draft = NEW.section_draft OR p.section_published = NEW.section_draft))
    OR EXISTS (SELECT 1 FROM mobile_drafts m, json_each(m.targets) j WHERE json_extract(j.value, '$.code') = NEW.section_draft))
BEGIN SELECT RAISE(ABORT, 'section_held'); END;
CREATE TRIGGER IF NOT EXISTS trg_partner_section_published_update
BEFORE UPDATE OF section_published ON partner_people
WHEN COALESCE(NEW.section_published, '') != ''
  AND NEW.section_published IS NOT OLD.section_published
  AND (EXISTS (SELECT 1 FROM taken_sections WHERE section_code = NEW.section_published AND organisation != 'И аз')
    OR EXISTS (SELECT 1 FROM signups WHERE COALESCE(withdrawn, 0) = 0 AND (draft_section = NEW.section_published OR published_section = NEW.section_published))
    OR EXISTS (SELECT 1 FROM partner_people p WHERE p.id != NEW.id AND (p.section_draft = NEW.section_published OR p.section_published = NEW.section_published))
    OR EXISTS (SELECT 1 FROM mobile_drafts m, json_each(m.targets) j WHERE json_extract(j.value, '$.code') = NEW.section_published))
BEGIN SELECT RAISE(ABORT, 'section_held'); END;
CREATE TRIGGER IF NOT EXISTS trg_partner_section_insert
BEFORE INSERT ON partner_people
WHEN COALESCE(NEW.section_draft, '') != '' OR COALESCE(NEW.section_published, '') != ''
BEGIN SELECT RAISE(ABORT, 'section_held'); END;
CREATE TRIGGER IF NOT EXISTS trg_signups_partner_draft_update
BEFORE UPDATE OF draft_section ON signups
WHEN COALESCE(NEW.draft_section, '') != ''
  AND NEW.draft_section IS NOT OLD.draft_section
  AND NEW.draft_section IS NOT OLD.published_section
  AND EXISTS (SELECT 1 FROM partner_people WHERE section_draft = NEW.draft_section OR section_published = NEW.draft_section)
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END;
CREATE TRIGGER IF NOT EXISTS trg_signups_partner_published_update
BEFORE UPDATE OF published_section ON signups
WHEN COALESCE(NEW.published_section, '') != ''
  AND NEW.published_section IS NOT OLD.published_section
  AND EXISTS (SELECT 1 FROM partner_people WHERE section_draft = NEW.published_section OR section_published = NEW.published_section)
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END;
CREATE TRIGGER IF NOT EXISTS trg_signups_partner_insert
BEFORE INSERT ON signups
WHEN (COALESCE(NEW.draft_section, '') != '' OR COALESCE(NEW.published_section, '') != '')
  AND EXISTS (SELECT 1 FROM partner_people
    WHERE (COALESCE(section_draft, '') != '' AND section_draft IN (NEW.draft_section, NEW.published_section))
       OR (COALESCE(section_published, '') != '' AND section_published IN (NEW.draft_section, NEW.published_section)))
BEGIN SELECT RAISE(ABORT, 'reserved_section'); END;

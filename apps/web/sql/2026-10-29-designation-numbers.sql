-- Number ledger („книга на номерата“): one row per пълномощно number ever used in a МИР, ours or
-- external (РИК register rows under our coalition that we never issued). The next number is
-- MAX(ledger) + 1, so moved, withdrawn and external numbers are never handed out again.
-- Also run by the app bootstrap (db-core.ts, designation-numbers.ts). Idempotent: the backfill only
-- fills numbers nobody claimed yet; nothing here touches signups, partner_people or rik_entries.
-- Needs designation_high_water (2026-10-22) and, for the last statement, rik_entries (2026-10-21).
--   pnpm exec wrangler d1 execute DB --remote --file sql/2026-10-29-designation-numbers.sql
--   pnpm exec wrangler d1 execute DB --env production --remote --file sql/2026-10-29-designation-numbers.sql

CREATE TABLE IF NOT EXISTS designation_numbers (
  mir TEXT NOT NULL,
  number INTEGER NOT NULL,
  issued_on TEXT NOT NULL DEFAULT '',
  holder TEXT NOT NULL,
  person_id TEXT,
  state TEXT NOT NULL,
  moved_to TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  rik_entry_id TEXT,
  rik_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (mir, number)
);

CREATE INDEX IF NOT EXISTS idx_designation_numbers_person ON designation_numbers(person_id);

CREATE INDEX IF NOT EXISTS idx_designation_numbers_state ON designation_numbers(state, mir);

CREATE TRIGGER IF NOT EXISTS trg_signups_designation_numbers_insert
AFTER INSERT ON signups
WHEN NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != ''
BEGIN
  INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, created_at, updated_at)
  SELECT NEW.designation_mir, NEW.designation_number, COALESCE(NEW.designation_issued_at, ''), 'signup', NEW.id,
    CASE WHEN COALESCE(NEW.withdrawn, 0) = 1 THEN 'withdrawn' ELSE 'active' END, datetime('now'), datetime('now')
  WHERE NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != ''
  ON CONFLICT(mir, number) DO UPDATE SET
    state = excluded.state,
    moved_to = '',
    issued_on = CASE WHEN excluded.issued_on != '' THEN excluded.issued_on ELSE designation_numbers.issued_on END,
    updated_at = excluded.updated_at
  WHERE designation_numbers.person_id = excluded.person_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_signups_designation_numbers_update
AFTER UPDATE OF designation_number, designation_mir, designation_issued_at, withdrawn ON signups
BEGIN
  UPDATE designation_numbers SET
    state = CASE WHEN NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != '' THEN 'moved' ELSE 'released' END,
    moved_to = CASE WHEN NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != '' THEN NEW.designation_mir || '/' || NEW.designation_number ELSE '' END,
    updated_at = datetime('now')
  WHERE OLD.designation_number IS NOT NULL AND COALESCE(OLD.designation_mir, '') != ''
    AND (NEW.designation_number IS NOT OLD.designation_number OR NEW.designation_mir IS NOT OLD.designation_mir)
    AND mir = OLD.designation_mir AND number = OLD.designation_number AND person_id = OLD.id;
  INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, created_at, updated_at)
  SELECT NEW.designation_mir, NEW.designation_number, COALESCE(NEW.designation_issued_at, ''), 'signup', NEW.id,
    CASE WHEN COALESCE(NEW.withdrawn, 0) = 1 THEN 'withdrawn' ELSE 'active' END, datetime('now'), datetime('now')
  WHERE NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != ''
  ON CONFLICT(mir, number) DO UPDATE SET
    state = excluded.state,
    moved_to = '',
    issued_on = CASE WHEN excluded.issued_on != '' THEN excluded.issued_on ELSE designation_numbers.issued_on END,
    updated_at = excluded.updated_at
  WHERE designation_numbers.person_id = excluded.person_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_partner_people_designation_numbers_insert
AFTER INSERT ON partner_people
WHEN NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != ''
BEGIN
  INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, created_at, updated_at)
  SELECT NEW.designation_mir, NEW.designation_number, COALESCE(NEW.designation_issued_at, ''), 'partner', NEW.id,
    CASE WHEN NEW.withdrawn_at IS NOT NULL THEN 'withdrawn' ELSE 'active' END, datetime('now'), datetime('now')
  WHERE NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != ''
  ON CONFLICT(mir, number) DO UPDATE SET
    state = excluded.state,
    moved_to = '',
    issued_on = CASE WHEN excluded.issued_on != '' THEN excluded.issued_on ELSE designation_numbers.issued_on END,
    updated_at = excluded.updated_at
  WHERE designation_numbers.person_id = excluded.person_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_partner_people_designation_numbers_update
AFTER UPDATE OF designation_number, designation_mir, designation_issued_at, withdrawn_at ON partner_people
BEGIN
  UPDATE designation_numbers SET
    state = CASE WHEN NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != '' THEN 'moved' ELSE 'released' END,
    moved_to = CASE WHEN NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != '' THEN NEW.designation_mir || '/' || NEW.designation_number ELSE '' END,
    updated_at = datetime('now')
  WHERE OLD.designation_number IS NOT NULL AND COALESCE(OLD.designation_mir, '') != ''
    AND (NEW.designation_number IS NOT OLD.designation_number OR NEW.designation_mir IS NOT OLD.designation_mir)
    AND mir = OLD.designation_mir AND number = OLD.designation_number AND person_id = OLD.id;
  INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, created_at, updated_at)
  SELECT NEW.designation_mir, NEW.designation_number, COALESCE(NEW.designation_issued_at, ''), 'partner', NEW.id,
    CASE WHEN NEW.withdrawn_at IS NOT NULL THEN 'withdrawn' ELSE 'active' END, datetime('now'), datetime('now')
  WHERE NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != ''
  ON CONFLICT(mir, number) DO UPDATE SET
    state = excluded.state,
    moved_to = '',
    issued_on = CASE WHEN excluded.issued_on != '' THEN excluded.issued_on ELSE designation_numbers.issued_on END,
    updated_at = excluded.updated_at
  WHERE designation_numbers.person_id = excluded.person_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_designation_numbers_high_water
AFTER INSERT ON designation_numbers
BEGIN
  INSERT INTO designation_high_water (mir, n, updated_at) VALUES (NEW.mir, NEW.number, datetime('now'))
  ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;
END;

INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note, created_at, updated_at)
SELECT mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note, datetime('now'), datetime('now') FROM (SELECT designation_mir AS mir, designation_number AS number, COALESCE(designation_issued_at, '') AS issued_on,
    'signup' AS holder, id AS person_id,
    CASE WHEN COALESCE(withdrawn, 0) = 1 THEN 'withdrawn' ELSE 'active' END AS state,
    '' AS moved_to, '' AS name, NULL AS rik_entry_id, '' AS rik_url, '' AS note
  FROM signups WHERE designation_number IS NOT NULL AND COALESCE(designation_mir, '') != '') WHERE 1
ON CONFLICT(mir, number) DO NOTHING;

INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note, created_at, updated_at)
SELECT mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note, datetime('now'), datetime('now') FROM (SELECT designation_mir AS mir, designation_number AS number, COALESCE(designation_issued_at, '') AS issued_on,
    'partner' AS holder, id AS person_id,
    CASE WHEN withdrawn_at IS NOT NULL THEN 'withdrawn' ELSE 'active' END AS state,
    '' AS moved_to, '' AS name, NULL AS rik_entry_id, '' AS rik_url, '' AS note
  FROM partner_people WHERE designation_number IS NOT NULL AND COALESCE(designation_mir, '') != '') WHERE 1
ON CONFLICT(mir, number) DO NOTHING;

INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note, created_at, updated_at)
SELECT mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note, datetime('now'), datetime('now') FROM (SELECT h.mir, h.number, h.issued_on,
    CASE WHEN h.person_id LIKE 'pp-%' THEN 'partner' ELSE 'signup' END AS holder, h.person_id,
    CASE WHEN COALESCE(NULLIF(h.next_label, h.mir || '/' || h.number), COALESCE(
      (SELECT designation_mir || '/' || designation_number FROM signups WHERE id = h.person_id AND designation_number IS NOT NULL),
      (SELECT designation_mir || '/' || designation_number FROM partner_people WHERE id = h.person_id AND designation_number IS NOT NULL), '')) != '' THEN 'moved' ELSE 'released' END AS state,
    COALESCE(NULLIF(h.next_label, h.mir || '/' || h.number), COALESCE(
      (SELECT designation_mir || '/' || designation_number FROM signups WHERE id = h.person_id AND designation_number IS NOT NULL),
      (SELECT designation_mir || '/' || designation_number FROM partner_people WHERE id = h.person_id AND designation_number IS NOT NULL), '')) AS moved_to,
    '' AS name, NULL AS rik_entry_id, '' AS rik_url, 'от историята' AS note
  FROM (
    SELECT signup_id AS person_id, substr(after_text, 1, 2) AS mir, CAST(substr(after_text, 4) AS INTEGER) AS number,
      CASE WHEN instr(after_text, ' от ') > 0 THEN substr(after_text, instr(after_text, ' от ') + 4, 10) ELSE '' END AS issued_on,
      LEAD(substr(after_text, 1, 2) || '/' || CAST(substr(after_text, 4) AS INTEGER)) OVER (PARTITION BY signup_id ORDER BY created_at, id) AS next_label
    FROM signup_audit
    WHERE field = 'designation_number' AND substr(after_text, 3, 1) = '/' AND substr(after_text, 1, 2) GLOB '[0-9][0-9]'
  ) h
  WHERE h.number >= 1) WHERE 1
ON CONFLICT(mir, number) DO NOTHING;

INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note, created_at, updated_at)
SELECT mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note, datetime('now'), datetime('now') FROM (SELECT r.mir, r.number, COALESCE(r.number_date, '') AS issued_on, 'external' AS holder, NULL AS person_id, 'external' AS state,
    '' AS moved_to, CASE WHEN r.annulled = 1 THEN '' ELSE r.name END AS name, r.id AS rik_entry_id, r.source_url AS rik_url,
    'в регистъра на РИК ' || r.mir
      || CASE WHEN r.annulled = 1 OR EXISTS (SELECT 1 FROM rik_entries x WHERE x.ours = 1 AND x.kind = 'representative' AND x.mir = r.mir AND x.number = r.number AND x.annulled = 1)
        THEN ', Анулиран' ELSE '' END
      || CASE WHEN r.missing_since IS NOT NULL THEN ', вече не е в регистъра' ELSE '' END AS note
  FROM rik_entries r
  WHERE r.ours = 1 AND r.kind = 'representative' AND r.number BETWEEN 1 AND 999 AND r.mir GLOB '[0-9][0-9]'
  ORDER BY r.annulled, r.missing_since IS NOT NULL, r.first_seen_at, r.id) WHERE 1
ON CONFLICT(mir, number) DO NOTHING;

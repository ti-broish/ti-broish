-- Numbers are never reused: per-МИР high-water mark of issued пълномощно numbers.
-- Also run by the app bootstrap (db-core.ts). Idempotent; only ever raises the mark.

CREATE TABLE IF NOT EXISTS designation_high_water (
  mir TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TRIGGER IF NOT EXISTS trg_signups_designation_high_water_insert
AFTER INSERT ON signups
WHEN NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != ''
BEGIN
  INSERT INTO designation_high_water (mir, n, updated_at) VALUES (NEW.designation_mir, NEW.designation_number, datetime('now'))
  ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;
END;

CREATE TRIGGER IF NOT EXISTS trg_signups_designation_high_water_update
AFTER UPDATE OF designation_number, designation_mir ON signups
WHEN NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != ''
BEGIN
  INSERT INTO designation_high_water (mir, n, updated_at) VALUES (NEW.designation_mir, NEW.designation_number, datetime('now'))
  ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;
END;

CREATE TRIGGER IF NOT EXISTS trg_partner_people_designation_high_water_insert
AFTER INSERT ON partner_people
WHEN NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != ''
BEGIN
  INSERT INTO designation_high_water (mir, n, updated_at) VALUES (NEW.designation_mir, NEW.designation_number, datetime('now'))
  ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;
END;

CREATE TRIGGER IF NOT EXISTS trg_partner_people_designation_high_water_update
AFTER UPDATE OF designation_number, designation_mir ON partner_people
WHEN NEW.designation_number IS NOT NULL AND COALESCE(NEW.designation_mir, '') != ''
BEGIN
  INSERT INTO designation_high_water (mir, n, updated_at) VALUES (NEW.designation_mir, NEW.designation_number, datetime('now'))
  ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;
END;

INSERT INTO designation_high_water (mir, n, updated_at)
SELECT mir, MAX(n), datetime('now') FROM (
  SELECT designation_mir AS mir, designation_number AS n FROM signups WHERE designation_number IS NOT NULL AND COALESCE(designation_mir, '') != ''
  UNION ALL
  SELECT designation_mir, designation_number FROM partner_people WHERE designation_number IS NOT NULL AND COALESCE(designation_mir, '') != ''
) WHERE 1 GROUP BY mir
ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;

INSERT INTO designation_high_water (mir, n, updated_at)
SELECT mir, MAX(n), datetime('now') FROM (
  SELECT substr(after_text, 1, 2) AS mir, CAST(substr(after_text, 4) AS INTEGER) AS n FROM signup_audit
  WHERE field = 'designation_number' AND substr(after_text, 3, 1) = '/' AND substr(after_text, 1, 2) GLOB '[0-9][0-9]'
) WHERE n >= 501 GROUP BY mir
ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;

INSERT INTO designation_high_water (mir, n, updated_at) VALUES ('31', 502, datetime('now'))
ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;

INSERT INTO designation_high_water (mir, n, updated_at) VALUES ('31', 504, datetime('now'))
ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;

INSERT INTO designation_high_water (mir, n, updated_at) VALUES ('03', 515, datetime('now'))
ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;

INSERT INTO designation_high_water (mir, n, updated_at) VALUES ('17', 506, datetime('now'))
ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;

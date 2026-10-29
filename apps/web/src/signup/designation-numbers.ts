/**
 * The number ledger („книга на номерата“): one row per пълномощно number ever used in a МИР,
 * ours or not. A number never leaves the ledger, so the next number is MAX(ledger) + 1 and a
 * number that moved, was withdrawn or is held by someone outside our database (a РИК register
 * row under our coalition) can never be handed out again.
 *
 * Our people's rows are kept by triggers on signups and partner_people, so no app path writes
 * here: assigning, moving to another МИР, a manual renumber, „Отпиши“ and „Върни“ all land
 * through the same triggers. External rows come from rik_entries (backfill below; the РИК
 * sync will add new ones in a later PR).
 *
 * holder: signup | partner | external
 * state:  active | moved (moved_to holds the new „МИР/номер“) | released (number cleared) |
 *         withdrawn (person отписан, number kept) | external
 */
export const DESIGNATION_NUMBERS_TABLE = `CREATE TABLE IF NOT EXISTS designation_numbers (
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
)`

export const DESIGNATION_NUMBERS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_designation_numbers_person ON designation_numbers(person_id)',
  'CREATE INDEX IF NOT EXISTS idx_designation_numbers_state ON designation_numbers(state, mir)',
]

type PersonTable = 'signups' | 'partner_people'

const holderOf = (table: PersonTable) => (table === 'signups' ? 'signup' : 'partner')
/** Withdrawn: signups.withdrawn = 1; „И аз“ rows carry withdrawn_at. */
const withdrawnOf = (table: PersonTable) => (table === 'signups' ? 'COALESCE(NEW.withdrawn, 0) = 1' : 'NEW.withdrawn_at IS NOT NULL')
const withdrawnColumn = (table: PersonTable) => (table === 'signups' ? 'withdrawn' : 'withdrawn_at')

const hasNumber = (row: 'NEW' | 'OLD') => `${row}.designation_number IS NOT NULL AND COALESCE(${row}.designation_mir, '') != ''`

/** Upsert NEW's number as this person's row; a row held by someone else (external) is left alone. */
const upsertNew = (table: PersonTable) => `INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, created_at, updated_at)
  SELECT NEW.designation_mir, NEW.designation_number, COALESCE(NEW.designation_issued_at, ''), '${holderOf(table)}', NEW.id,
    CASE WHEN ${withdrawnOf(table)} THEN 'withdrawn' ELSE 'active' END, datetime('now'), datetime('now')
  WHERE ${hasNumber('NEW')}
  ON CONFLICT(mir, number) DO UPDATE SET
    state = excluded.state,
    moved_to = '',
    issued_on = CASE WHEN excluded.issued_on != '' THEN excluded.issued_on ELSE designation_numbers.issued_on END,
    updated_at = excluded.updated_at
  WHERE designation_numbers.person_id = excluded.person_id`

/** OLD's number when it changed: „moved“ to NEW's number, or „released“ when cleared. */
const MARK_OLD_MOVED = `UPDATE designation_numbers SET
    state = CASE WHEN ${hasNumber('NEW')} THEN 'moved' ELSE 'released' END,
    moved_to = CASE WHEN ${hasNumber('NEW')} THEN NEW.designation_mir || '/' || NEW.designation_number ELSE '' END,
    updated_at = datetime('now')
  WHERE ${hasNumber('OLD')}
    AND (NEW.designation_number IS NOT OLD.designation_number OR NEW.designation_mir IS NOT OLD.designation_mir)
    AND mir = OLD.designation_mir AND number = OLD.designation_number AND person_id = OLD.id`

export const DESIGNATION_NUMBERS_TRIGGERS = (['signups', 'partner_people'] as const).flatMap((table) => [
  `CREATE TRIGGER IF NOT EXISTS trg_${table}_designation_numbers_insert
AFTER INSERT ON ${table}
WHEN ${hasNumber('NEW')}
BEGIN
  ${upsertNew(table)};
END`,
  `CREATE TRIGGER IF NOT EXISTS trg_${table}_designation_numbers_update
AFTER UPDATE OF designation_number, designation_mir, designation_issued_at, ${withdrawnColumn(table)} ON ${table}
BEGIN
  ${MARK_OLD_MOVED};
  ${upsertNew(table)};
END`,
])

/** Safety net: every ledger row (also an external one) raises the per-МИР high-water mark. */
export const DESIGNATION_NUMBERS_HIGH_WATER_TRIGGER = `CREATE TRIGGER IF NOT EXISTS trg_designation_numbers_high_water
AFTER INSERT ON designation_numbers
BEGIN
  INSERT INTO designation_high_water (mir, n, updated_at) VALUES (NEW.mir, NEW.number, datetime('now'))
  ON CONFLICT(mir) DO UPDATE SET n = MAX(n, excluded.n), updated_at = excluded.updated_at WHERE excluded.n > n;
END`

const CURRENT_SELECT = (table: PersonTable) => `SELECT designation_mir AS mir, designation_number AS number, COALESCE(designation_issued_at, '') AS issued_on,
    '${holderOf(table)}' AS holder, id AS person_id,
    CASE WHEN ${withdrawnOf(table).replace(/NEW\./g, '')} THEN 'withdrawn' ELSE 'active' END AS state,
    '' AS moved_to, '' AS name, NULL AS rik_entry_id, '' AS rik_url, '' AS note
  FROM ${table} WHERE designation_number IS NOT NULL AND COALESCE(designation_mir, '') != ''`

/**
 * Old numbers from the audit („23/514 от 22.10.2026“, then „26/525 от 22.10.2026“): every
 * 'designation_number' line whose number nobody holds now. moved_to is the person's next line,
 * else their current number; no number now → released.
 */
const CURRENT_LABEL = `COALESCE(
      (SELECT designation_mir || '/' || designation_number FROM signups WHERE id = h.person_id AND designation_number IS NOT NULL),
      (SELECT designation_mir || '/' || designation_number FROM partner_people WHERE id = h.person_id AND designation_number IS NOT NULL), '')`

export const AUDIT_HISTORY_SELECT = `SELECT h.mir, h.number, h.issued_on,
    CASE WHEN h.person_id LIKE 'pp-%' THEN 'partner' ELSE 'signup' END AS holder, h.person_id,
    CASE WHEN COALESCE(NULLIF(h.next_label, h.mir || '/' || h.number), ${CURRENT_LABEL}) != '' THEN 'moved' ELSE 'released' END AS state,
    COALESCE(NULLIF(h.next_label, h.mir || '/' || h.number), ${CURRENT_LABEL}) AS moved_to,
    '' AS name, NULL AS rik_entry_id, '' AS rik_url, 'от историята' AS note
  FROM (
    SELECT signup_id AS person_id, substr(after_text, 1, 2) AS mir, CAST(substr(after_text, 4) AS INTEGER) AS number,
      CASE WHEN instr(after_text, ' от ') > 0 THEN substr(after_text, instr(after_text, ' от ') + 4, 10) ELSE '' END AS issued_on,
      LEAD(substr(after_text, 1, 2) || '/' || CAST(substr(after_text, 4) AS INTEGER)) OVER (PARTITION BY signup_id ORDER BY created_at, id) AS next_label
    FROM signup_audit
    WHERE field = 'designation_number' AND substr(after_text, 3, 1) = '/' AND substr(after_text, 1, 2) GLOB '[0-9][0-9]'
  ) h
  WHERE h.number >= 1`

/**
 * Register rows under our coalition whose number we never issued: someone outside our
 * database holds it (or held it, „Анулиран“). Only what the РИК publishes is kept: the name,
 * the date and the page. A named row wins over an „Анулиран“ one for the same number (the name
 * is who held it), and the note says when the number was annulled or left the register.
 * Numbers above 999 are treated as a parsing slip and ignored, so a bad row cannot burn a range.
 */
export const RIK_EXTERNAL_SELECT = `SELECT r.mir, r.number, COALESCE(r.number_date, '') AS issued_on, 'external' AS holder, NULL AS person_id, 'external' AS state,
    '' AS moved_to, CASE WHEN r.annulled = 1 THEN '' ELSE r.name END AS name, r.id AS rik_entry_id, r.source_url AS rik_url,
    'в регистъра на РИК ' || r.mir
      || CASE WHEN r.annulled = 1 OR EXISTS (SELECT 1 FROM rik_entries x WHERE x.ours = 1 AND x.kind = 'representative' AND x.mir = r.mir AND x.number = r.number AND x.annulled = 1)
        THEN ', Анулиран' ELSE '' END
      || CASE WHEN r.missing_since IS NOT NULL THEN ', вече не е в регистъра' ELSE '' END AS note
  FROM rik_entries r
  WHERE r.ours = 1 AND r.kind = 'representative' AND r.number BETWEEN 1 AND 999 AND r.mir GLOB '[0-9][0-9]'
  ORDER BY r.annulled, r.missing_since IS NOT NULL, r.first_seen_at, r.id`

const COLUMNS = 'mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note'

const insertFrom = (select: string) => `INSERT INTO designation_numbers (${COLUMNS}, created_at, updated_at)
SELECT ${COLUMNS}, datetime('now'), datetime('now') FROM (${select}) WHERE 1
ON CONFLICT(mir, number) DO NOTHING`

/**
 * Idempotent backfill, in precedence order: current holders first, then old numbers from
 * the audit, then external register rows. Each step only fills numbers nobody claimed yet.
 */
export const DESIGNATION_NUMBERS_BACKFILL = [
  insertFrom(CURRENT_SELECT('signups')),
  insertFrom(CURRENT_SELECT('partner_people')),
  insertFrom(AUDIT_HISTORY_SELECT),
]

/** Separate: rik_entries is created by the РИК sync and may not exist yet on a fresh database. */
export const DESIGNATION_NUMBERS_RIK_BACKFILL = insertFrom(RIK_EXTERNAL_SELECT)

/**
 * Read-only dry run of the backfill with the same SELECTs and the same precedence, for
 * `wrangler d1 execute --command` against a database we must not write to.
 */
export const DESIGNATION_NUMBERS_DRY_RUN_SQL = `WITH
  cur AS (${CURRENT_SELECT('signups')} UNION ALL ${CURRENT_SELECT('partner_people')}),
  hist AS (SELECT * FROM (${AUDIT_HISTORY_SELECT}) a WHERE NOT EXISTS (SELECT 1 FROM cur WHERE cur.mir = a.mir AND cur.number = a.number)),
  hist1 AS (SELECT * FROM hist GROUP BY mir, number),
  ext AS (SELECT * FROM (${RIK_EXTERNAL_SELECT}) e
    WHERE NOT EXISTS (SELECT 1 FROM cur WHERE cur.mir = e.mir AND cur.number = e.number)
      AND NOT EXISTS (SELECT 1 FROM hist1 WHERE hist1.mir = e.mir AND hist1.number = e.number)),
  ext1 AS (SELECT * FROM ext GROUP BY mir, number),
  allrows AS (SELECT mir, number, holder, state FROM cur UNION ALL SELECT mir, number, holder, state FROM hist1 UNION ALL SELECT mir, number, holder, state FROM ext1)
SELECT holder, state, COUNT(*) AS n FROM allrows GROUP BY holder, state ORDER BY holder, state`

/** Every statement the bootstrap runs for the ledger, in order. */
export const DESIGNATION_NUMBERS_SQL = [
  DESIGNATION_NUMBERS_TABLE,
  ...DESIGNATION_NUMBERS_INDEXES,
  ...DESIGNATION_NUMBERS_TRIGGERS,
  DESIGNATION_NUMBERS_HIGH_WATER_TRIGGER,
  ...DESIGNATION_NUMBERS_BACKFILL,
  DESIGNATION_NUMBERS_RIK_BACKFILL,
]

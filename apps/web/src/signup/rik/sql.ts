/**
 * РИК registration tracking. Also in sql/2026-10-21-rik-registrations.sql; db-core creates
 * the tables at runtime like every other table. Nothing here touches signups, partner_people,
 * sections or drafts: the sync only reads them and writes these tables.
 */
export const RIK_TABLES = [
  // One row per МИР: where its registers live and how the last fetch went.
  `CREATE TABLE IF NOT EXISTS rik_sources (
  mir TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  contacts_url TEXT NOT NULL DEFAULT '',
  phones TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  contacts_at TEXT,
  adapter TEXT NOT NULL DEFAULT '',
  health TEXT NOT NULL DEFAULT 'never',
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_change_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  failures INTEGER NOT NULL DEFAULT 0,
  pages INTEGER NOT NULL DEFAULT 0,
  batches INTEGER NOT NULL DEFAULT 0,
  our_entries INTEGER NOT NULL DEFAULT 0,
  other_matches INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT '',
  last_good_health TEXT NOT NULL DEFAULT '',
  blocked_until TEXT
)`,
  // Every page fetched, with a content hash so an unchanged page costs no writes.
  `CREATE TABLE IF NOT EXISTS rik_pages (
  url TEXT PRIMARY KEY,
  mir TEXT NOT NULL,
  kind TEXT NOT NULL,
  party TEXT NOT NULL DEFAULT '',
  ours INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT '',
  http_status INTEGER NOT NULL DEFAULT 0,
  rows INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  etag TEXT NOT NULL DEFAULT '',
  last_modified TEXT NOT NULL DEFAULT ''
)`,
  // Register rows as published. Our committee: every row. Other parties: only rows whose name
  // matches one of our people (to spot double registrations), nothing else is kept.
  `CREATE TABLE IF NOT EXISTS rik_entries (
  id TEXT PRIMARY KEY,
  mir TEXT NOT NULL,
  kind TEXT NOT NULL,
  ours INTEGER NOT NULL,
  party TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  number_raw TEXT NOT NULL DEFAULT '',
  number INTEGER,
  number_date TEXT,
  annulled INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  missing_since TEXT
)`,
  // Derived per person who holds a пълномощно (signups and „И аз“ partner people).
  `CREATE TABLE IF NOT EXISTS rik_status (
  person_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  mir TEXT NOT NULL,
  number INTEGER,
  status TEXT NOT NULL,
  entry_id TEXT,
  other_mir TEXT NOT NULL DEFAULT '',
  other_party TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  status_since TEXT NOT NULL,
  checked_at TEXT NOT NULL
)`,
  // Derived tasks. A task stays when its cause goes away (active = 0), so done/undo history is kept.
  `CREATE TABLE IF NOT EXISTS rik_tasks (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  mir TEXT NOT NULL,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  done_at TEXT,
  done_by TEXT
)`,
  `CREATE TABLE IF NOT EXISTS rik_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  fetched INTEGER NOT NULL DEFAULT 0,
  changed INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT ''
)`,
]

/**
 * Columns added after the tables first shipped: [table, column, definition]. Added when missing.
 * rik_sources.last_good_health: the health of the last successful read, used while a РИК is in „warning“.
 * rik_runs.status: running | ok | partial | failed | missed.
 * rik_sources.blocked_until: the host answered with a challenge/403/429; leave it alone until then.
 * rik_pages.etag / last_modified: validators for conditional requests (when the server sends them).
 * rik_sources.submitted_at: when our пълномощни actually went to this РИК; the „call the РИК“ clock
 * starts no earlier than this (set by hand, e.g. after a batch is re-sent).
 */
export const RIK_COLUMNS: Array<[string, string, string]> = [
  ['rik_sources', 'last_good_health', "TEXT NOT NULL DEFAULT ''"],
  ['rik_runs', 'status', "TEXT NOT NULL DEFAULT ''"],
  ['rik_sources', 'blocked_until', 'TEXT'],
  ['rik_pages', 'etag', "TEXT NOT NULL DEFAULT ''"],
  ['rik_pages', 'last_modified', "TEXT NOT NULL DEFAULT ''"],
  ['rik_sources', 'submitted_at', 'TEXT'],
]

export const RIK_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_rik_entries_mir ON rik_entries(mir, kind, ours)',
  'CREATE INDEX IF NOT EXISTS idx_rik_entries_key ON rik_entries(name_key)',
  'CREATE INDEX IF NOT EXISTS idx_rik_entries_number ON rik_entries(mir, number)',
  'CREATE INDEX IF NOT EXISTS idx_rik_entries_source ON rik_entries(source_url)',
  'CREATE INDEX IF NOT EXISTS idx_rik_pages_mir ON rik_pages(mir)',
  'CREATE INDEX IF NOT EXISTS idx_rik_status_mir ON rik_status(mir, status)',
  'CREATE INDEX IF NOT EXISTS idx_rik_tasks_open ON rik_tasks(active, done_at, type)',
  'CREATE INDEX IF NOT EXISTS idx_rik_tasks_mir ON rik_tasks(mir)',
]

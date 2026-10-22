-- Partner origin (?origin= on /signal, e.g. iaz) of a signal sent to the Ти Броиш API.
-- Keyed by the API's violation id. Also created on first use by signal-origin.ts. Additive.

CREATE TABLE IF NOT EXISTS signal_origins (
  violation_id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL
);

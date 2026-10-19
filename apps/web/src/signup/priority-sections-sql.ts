/** Domestic priority sections (risk-scored list). Re-upload in admin replaces every row. */
export const PRIORITY_SECTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS priority_sections (
  section_code TEXT PRIMARY KEY,
  town TEXT NOT NULL DEFAULT '',
  municipality TEXT NOT NULL DEFAULT '',
  oblast TEXT NOT NULL DEFAULT '',
  r REAL,
  level TEXT NOT NULL DEFAULT '',
  components TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
)`

export const PRIORITY_SECTIONS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_priority_sections_r ON priority_sections(r DESC)',
  'CREATE INDEX IF NOT EXISTS idx_priority_sections_municipality ON priority_sections(municipality)',
]

export const PRIORITY_SECTIONS_INSERT = `INSERT INTO priority_sections (
  section_code, town, municipality, oblast, r, level, components, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

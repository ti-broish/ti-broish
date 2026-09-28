// D1 ships SQLite FTS5. The virtual table is additive: a version row in app_meta
// rebuilds it once, and triggers keep later signup writes in the index.
// If this SQLite build has no FTS5, search falls back to bound LIKE clauses.

const SEARCH_INDEX_VERSION = '1'

const FTS_UNICODE = `CREATE VIRTUAL TABLE signup_fts USING fts5(
  signup_id UNINDEXED,
  name,
  email,
  phone,
  egn,
  section,
  place,
  tokenize = 'unicode61 remove_diacritics 2'
)`

const FTS_PLAIN = `CREATE VIRTUAL TABLE signup_fts USING fts5(
  signup_id UNINDEXED,
  name,
  email,
  phone,
  egn,
  section,
  place,
  tokenize = 'unicode61'
)`

const PHONE_EXPR =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(json_extract(payload, '$.phone'), ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', '')"

const FTS_SELECT = `SELECT
  id,
  trim(COALESCE(json_extract(payload, '$.firstName'), '') || ' ' || COALESCE(json_extract(payload, '$.middleName'), '') || ' ' || COALESCE(json_extract(payload, '$.lastName'), '')),
  COALESCE(email, ''),
  trim(COALESCE(json_extract(payload, '$.phone'), '') || ' ' || ${PHONE_EXPR}),
  COALESCE(egn, ''),
  trim(COALESCE(draft_section, '') || ' ' || COALESCE(published_section, '')),
  trim(COALESCE(town_name, '') || ' ' || COALESCE(section_place, '') || ' ' || COALESCE(municipality_name, '') || ' ' || COALESCE(city_region_name, '') || ' ' || COALESCE(mir_code, ''))
FROM signups`

const FTS_REBUILD = `INSERT INTO signup_fts(signup_id, name, email, phone, egn, section, place) ${FTS_SELECT}`

const TRIGGER_INSERT = `CREATE TRIGGER signup_fts_ai AFTER INSERT ON signups BEGIN
  INSERT INTO signup_fts(signup_id, name, email, phone, egn, section, place)
  VALUES (
    new.id,
    trim(COALESCE(json_extract(new.payload, '$.firstName'), '') || ' ' || COALESCE(json_extract(new.payload, '$.middleName'), '') || ' ' || COALESCE(json_extract(new.payload, '$.lastName'), '')),
    COALESCE(new.email, ''),
    trim(COALESCE(json_extract(new.payload, '$.phone'), '') || ' ' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(json_extract(new.payload, '$.phone'), ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', '')),
    COALESCE(new.egn, ''),
    trim(COALESCE(new.draft_section, '') || ' ' || COALESCE(new.published_section, '')),
    trim(COALESCE(new.town_name, '') || ' ' || COALESCE(new.section_place, '') || ' ' || COALESCE(new.municipality_name, '') || ' ' || COALESCE(new.city_region_name, '') || ' ' || COALESCE(new.mir_code, ''))
  );
END`

const TRIGGER_DELETE = `CREATE TRIGGER signup_fts_ad AFTER DELETE ON signups BEGIN
  DELETE FROM signup_fts WHERE signup_id = old.id;
END`

const TRIGGER_UPDATE = `CREATE TRIGGER signup_fts_au AFTER UPDATE ON signups BEGIN
  DELETE FROM signup_fts WHERE signup_id = old.id;
  INSERT INTO signup_fts(signup_id, name, email, phone, egn, section, place)
  VALUES (
    new.id,
    trim(COALESCE(json_extract(new.payload, '$.firstName'), '') || ' ' || COALESCE(json_extract(new.payload, '$.middleName'), '') || ' ' || COALESCE(json_extract(new.payload, '$.lastName'), '')),
    COALESCE(new.email, ''),
    trim(COALESCE(json_extract(new.payload, '$.phone'), '') || ' ' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(json_extract(new.payload, '$.phone'), ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', '')),
    COALESCE(new.egn, ''),
    trim(COALESCE(new.draft_section, '') || ' ' || COALESCE(new.published_section, '')),
    trim(COALESCE(new.town_name, '') || ' ' || COALESCE(new.section_place, '') || ' ' || COALESCE(new.municipality_name, '') || ' ' || COALESCE(new.city_region_name, '') || ' ' || COALESCE(new.mir_code, ''))
  );
END`

interface Runnable {
  run(): Promise<unknown>
  first<T>(): Promise<T | null>
  bind(...values: unknown[]): Runnable
}

export interface SearchDatabase {
  prepare(sql: string): Runnable
}

let signupSearchEngine: 'fts' | 'like' = 'fts'

export function currentSearchEngine() {
  return signupSearchEngine
}

export function useLikeSearch() {
  signupSearchEngine = 'like'
}

export function isFtsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /fts5|no such module|signup_fts|MATCH/i.test(message)
}

export async function ensureSearchIndex(db: SearchDatabase) {
  try {
    await db.prepare('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_signups_egn ON signups(egn)').run()
    const current = await db.prepare(`SELECT value FROM app_meta WHERE key = 'signup_fts'`).first<{ value: string }>()
    if (current?.value === SEARCH_INDEX_VERSION) {
      signupSearchEngine = 'fts'
      return
    }
    await rebuild(db)
    await db
      .prepare(`INSERT INTO app_meta (key, value) VALUES ('signup_fts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .bind(SEARCH_INDEX_VERSION)
      .run()
    signupSearchEngine = 'fts'
  } catch (error) {
    if (!isFtsError(error)) throw error
    signupSearchEngine = 'like'
  }
}

async function rebuild(db: SearchDatabase) {
  await db.prepare('DROP TRIGGER IF EXISTS signup_fts_ai').run()
  await db.prepare('DROP TRIGGER IF EXISTS signup_fts_au').run()
  await db.prepare('DROP TRIGGER IF EXISTS signup_fts_ad').run()
  await db.prepare('DROP TABLE IF EXISTS signup_fts').run()
  try {
    await db.prepare(FTS_UNICODE).run()
  } catch {
    await db.prepare('DROP TABLE IF EXISTS signup_fts').run()
    await db.prepare(FTS_PLAIN).run()
  }
  await db.prepare(TRIGGER_INSERT).run()
  await db.prepare(TRIGGER_UPDATE).run()
  await db.prepare(TRIGGER_DELETE).run()
  await db.prepare(FTS_REBUILD).run()
}

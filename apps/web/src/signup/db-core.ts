import { migrateCompanionColumns } from './db-core-migrate-companions'
import { ensureSearchIndex } from './db-search'
import { env } from 'cloudflare:workers'
import { visibleSection } from './admin-csv'
import { emptyProfile, type Profile } from './model'
import { parseAdminEmails } from './staff'

export const SESSION_COOKIE = 'tb_session'

const SIGNUPS = `
CREATE TABLE IF NOT EXISTS signups (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  session_token TEXT UNIQUE,
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  payload TEXT NOT NULL,
  email_confirmed INTEGER NOT NULL DEFAULT 0,
  withdrawn INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`

const BASE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_signups_referral ON signups(referral_code)',
  'CREATE INDEX IF NOT EXISTS idx_signups_session ON signups(session_token)',
]

const ADD_COLUMNS = [
  'ALTER TABLE signups ADD COLUMN source TEXT',
  'ALTER TABLE signups ADD COLUMN egn TEXT',
  'ALTER TABLE signups ADD COLUMN role TEXT',
  'ALTER TABLE signups ADD COLUMN rounds_first INTEGER',
  'ALTER TABLE signups ADD COLUMN rounds_runoff INTEGER',
  'ALTER TABLE signups ADD COLUMN experience TEXT',
  'ALTER TABLE signups ADD COLUMN region_code TEXT',
  'ALTER TABLE signups ADD COLUMN mir_code TEXT',
  'ALTER TABLE signups ADD COLUMN municipality_name TEXT',
  'ALTER TABLE signups ADD COLUMN town_name TEXT',
  'ALTER TABLE signups ADD COLUMN city_region_code TEXT',
  'ALTER TABLE signups ADD COLUMN city_region_name TEXT',
  'ALTER TABLE signups ADD COLUMN section_place TEXT',
  'ALTER TABLE signups ADD COLUMN paper_count INTEGER',
  'ALTER TABLE signups ADD COLUMN machine_count INTEGER',
  'ALTER TABLE signups ADD COLUMN radius TEXT',
  'ALTER TABLE signups ADD COLUMN extra_city_regions TEXT',
  'ALTER TABLE signups ADD COLUMN distant_region_codes TEXT',
  'ALTER TABLE signups ADD COLUMN travel_municipalities TEXT',
  'ALTER TABLE signups ADD COLUMN has_car INTEGER',
  'ALTER TABLE signups ADD COLUMN car_seats INTEGER',
  'ALTER TABLE signups ADD COLUMN has_drone INTEGER',
  'ALTER TABLE signups ADD COLUMN coordinator INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE signups ADD COLUMN consent INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE signups ADD COLUMN submitted INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE signups ADD COLUMN notes TEXT',
  'ALTER TABLE signups ADD COLUMN draft_section TEXT',
  'ALTER TABLE signups ADD COLUMN published_section TEXT',
  'ALTER TABLE signups ADD COLUMN published_at TEXT',
  'ALTER TABLE signups ADD COLUMN imported INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE signups ADD COLUMN confirm_token TEXT',
  'ALTER TABLE signups ADD COLUMN email_code TEXT',
  'ALTER TABLE signups ADD COLUMN pending_email TEXT',
  'ALTER TABLE signups ADD COLUMN signup_mail_at TEXT',
  'ALTER TABLE signups ADD COLUMN staff_note TEXT',
  'ALTER TABLE signups ADD COLUMN staff_called_at TEXT',
  'ALTER TABLE signups ADD COLUMN staff_called_by TEXT',
]

const COMPANIONS = `
CREATE TABLE IF NOT EXISTS companions (
  id TEXT PRIMARY KEY,
  signup_id TEXT NOT NULL,
  in_group INTEGER NOT NULL DEFAULT 1,
  first_name TEXT NOT NULL,
  middle_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT,
  same_place INTEGER NOT NULL DEFAULT 1
)`

const TAKEN = `
CREATE TABLE IF NOT EXISTS taken_sections (
  section_code TEXT PRIMARY KEY,
  mir_code TEXT,
  place TEXT,
  organisation TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
)`

const STAFF = `
CREATE TABLE IF NOT EXISTS staff (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  invited_by TEXT,
  created_at TEXT NOT NULL
)`

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_signups_source ON signups(source)',
  'CREATE INDEX IF NOT EXISTS idx_signups_mir ON signups(mir_code)',
  'CREATE INDEX IF NOT EXISTS idx_signups_role ON signups(role)',
  'CREATE INDEX IF NOT EXISTS idx_signups_confirm ON signups(confirm_token)',
  'CREATE INDEX IF NOT EXISTS idx_companions_signup ON companions(signup_id)',
  'CREATE INDEX IF NOT EXISTS idx_taken_mir ON taken_sections(mir_code)',
]

export interface SignupRow {
  id: string
  payload: string
  referral_code: string | null
  referred_by: string | null
  source: string | null
  egn: string | null
  published_section: string | null
}

interface Statement {
  run(): Promise<unknown>
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results?: T[] }>
  bind(...values: unknown[]): Statement
}

export interface SignupD1 {
  prepare(sql: string): Statement
}

export async function signupDatabase() {
  const db = (env as unknown as { DB?: SignupD1 }).DB
  if (!db) return null
  await db.prepare(SIGNUPS).run()
  for (const sql of BASE_INDEXES) await db.prepare(sql).run()
  let addedReceiptColumn = false
  for (const sql of ADD_COLUMNS) {
    try {
      await db.prepare(sql).run()
      if (sql.includes('signup_mail_at')) addedReceiptColumn = true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/duplicate column/i.test(message)) throw error
    }
  }
  // Rows already submitted before this column existed must not get a late letter.
  if (addedReceiptColumn) {
    await db.prepare(`UPDATE signups SET signup_mail_at = 'skipped' WHERE COALESCE(submitted, 0) = 1 AND signup_mail_at IS NULL`).run()
  }
  await db.prepare(COMPANIONS).run()
  await migrateCompanionColumns(db)
  await db.prepare(TAKEN).run()
  await db.prepare(STAFF).run()
  for (const sql of INDEXES) await db.prepare(sql).run()
  const now = new Date().toISOString()
  for (const email of parseAdminEmails((env as unknown as { ADMIN_EMAILS?: string }).ADMIN_EMAILS)) {
    await db.prepare(`INSERT INTO staff (email, role, invited_by, created_at) VALUES (?, 'admin', 'env', ?) ON CONFLICT(email) DO NOTHING`).bind(email, now).run()
  }
  await ensureSearchIndex(db)
  return db
}

export function profileFrom(row: SignupRow): Profile {
  const parsed = JSON.parse(row.payload) as Partial<Profile> & { draftSection?: unknown; demoState?: unknown }
  delete parsed.draftSection
  delete parsed.assignedSection
  delete parsed.demoState
  return {
    ...emptyProfile(),
    ...parsed,
    referralCode: row.referral_code ?? parsed.referralCode ?? '',
    referredBy: row.referred_by ?? parsed.referredBy ?? null,
    source: row.source ?? parsed.source ?? null,
    egn: row.egn || parsed.egn || '',
    assignedSection: visibleSection(row.published_section),
  }
}

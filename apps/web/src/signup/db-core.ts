import { migrateCompanionColumns } from './db-core-migrate-companions'
import { DESIGNATION_HIGH_WATER_SEED, DESIGNATION_HIGH_WATER_TABLE, DESIGNATION_HIGH_WATER_TRIGGERS, DESIGNATION_NUMBER_UNIQUE_INDEX_SQL } from './designation-number'
import { ensureSearchIndex } from './db-search'
import { env } from 'cloudflare:workers'
import { visibleSection } from './admin-csv'
import { normalizeCantReachSection } from './cant-reach'
import { emptyProfile, type Profile } from './model'
import { parseAdminEmails } from './staff'
import { PRIORITY_SECTIONS_INDEXES, PRIORITY_SECTIONS_TABLE } from './priority-sections-sql'
import { SIGNED_WAVE_COLUMNS } from './signed-waves-sql'
import { releaseWithdrawnSections } from './withdrawal'
import { SIGNING_GENERATED_COLUMNS } from './designation-sign-scope'
import { PARTNER_PEOPLE_INDEXES, PARTNER_PEOPLE_TABLE, PARTNER_SECTION_COLUMNS, PARTNER_SECTION_GUARDS, PARTNER_WITHDRAWAL_COLUMNS } from './partner-people-sql'
import { RESERVED_SECTION_GUARDS } from './reserved-sections-sql'
import { MOBILE_DRAFTS_GUARDS, MOBILE_DRAFTS_TABLE } from './mobile-teams-sql'
import { SIGNUP_SCHEMA_META_KEY, schemaFingerprint } from './schema-version'

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
  'ALTER TABLE signups ADD COLUMN draft_locked INTEGER NOT NULL DEFAULT 0',
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
  'ALTER TABLE signups ADD COLUMN designation_number INTEGER',
  'ALTER TABLE signups ADD COLUMN designation_issued_at TEXT',
  'ALTER TABLE signups ADD COLUMN designation_pdf_url TEXT',
  'ALTER TABLE signups ADD COLUMN designation_drive_file_id TEXT',
  'ALTER TABLE signups ADD COLUMN designation_generated_at TEXT',
  'ALTER TABLE signups ADD COLUMN designation_signed_at TEXT',
  'ALTER TABLE signups ADD COLUMN designation_mir TEXT',
  'ALTER TABLE signups ADD COLUMN withdrawn_at TEXT',
  'ALTER TABLE signups ADD COLUMN withdrawn_by TEXT',
  'ALTER TABLE signups ADD COLUMN withdrawn_reason TEXT',
  'ALTER TABLE signups ADD COLUMN withdrawn_note TEXT',
  'ALTER TABLE signups ADD COLUMN withdrawal_processed_at TEXT',
  'ALTER TABLE signups ADD COLUMN withdrawal_processed_by TEXT',
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

/** Abroad coverage from Yana's priority workbook — counts only, no personal data. Re-upload replaces rows. */
const ABROAD_PRIORITY = `
CREATE TABLE IF NOT EXISTS abroad_priority_sections (
  section_code TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  place_label TEXT NOT NULL DEFAULT '',
  members INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL,
  tier_letter TEXT NOT NULL,
  ppdb_seats INTEGER NOT NULL DEFAULT 0,
  da_seats INTEGER NOT NULL DEFAULT 0,
  ppdb_seats_without_nominee INTEGER NOT NULL DEFAULT 0,
  party_seats_allocated_in_file INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)`

const STAFF = `
CREATE TABLE IF NOT EXISTS staff (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  invited_by TEXT,
  created_at TEXT NOT NULL
)`

const AUDIT = `
CREATE TABLE IF NOT EXISTS signup_audit (
  id TEXT PRIMARY KEY,
  signup_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  field TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  created_at TEXT NOT NULL
)`

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_signups_source ON signups(source)',
  'CREATE INDEX IF NOT EXISTS idx_signups_mir ON signups(mir_code)',
  'CREATE INDEX IF NOT EXISTS idx_signups_role ON signups(role)',
  'CREATE INDEX IF NOT EXISTS idx_signups_confirm ON signups(confirm_token)',
  'CREATE INDEX IF NOT EXISTS idx_companions_signup ON companions(signup_id)',
  'CREATE INDEX IF NOT EXISTS idx_taken_mir ON taken_sections(mir_code)',
  'CREATE INDEX IF NOT EXISTS idx_signups_staff_called ON signups(staff_called_at)',
  'CREATE INDEX IF NOT EXISTS idx_abroad_priority_country ON abroad_priority_sections(country)',
  'CREATE INDEX IF NOT EXISTS idx_abroad_priority_city ON abroad_priority_sections(city)',
  'CREATE INDEX IF NOT EXISTS idx_abroad_priority_tier ON abroad_priority_sections(tier_letter)',
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
  batch<T = unknown>(statements: Statement[]): Promise<T[]>
}

/**
 * Schema bootstrap runs once per isolate per D1 binding, not on every request: it is ~80 sequential
 * D1 round trips, and three parallel signed uploads each repeating them made D1 drop connections
 * („Network connection lost“ → a bare „HTTPError“ on /admin/palnomoshtni). A failed run is
 * forgotten so the next request tries again.
 */
const schemaReady = new WeakMap<object, Promise<void>>()

/**
 * The bootstrap promise is cached per isolate, so a D1 call inside it that never settles (seen on
 * 21.10.2026 after a table export locked D1: every later request in that isolate awaited the same
 * dead promise, cpu 0 ms, until the client gave up; /admin/sections and loadSignup never answered)
 * must not hang the isolate forever. Past this deadline the run counts as failed, is forgotten, and
 * the next request starts a fresh one.
 */
export const SCHEMA_DEADLINE_MS = 10_000
/** The withdrawn-seat backfill is best effort; a request never waits on it longer than this. */
export const WITHDRAWN_SWEEP_DEADLINE_MS = 5_000

export function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish in ${ms} ms`)), ms)
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

export async function signupDatabase() {
  const db = (env as unknown as { DB?: SignupD1 }).DB
  if (!db) return null
  let ready = schemaReady.get(db)
  if (!ready) {
    const pending = withDeadline(ensureSignupSchema(db), SCHEMA_DEADLINE_MS, 'signup schema bootstrap')
    ready = pending
    schemaReady.set(db, pending)
    pending.catch((error) => {
      console.warn('signup schema bootstrap failed', error instanceof Error ? error.message : error)
      if (schemaReady.get(db) === pending) schemaReady.delete(db)
    })
  }
  await ready
  return db
}

async function ensureSignupSchema(db: SignupD1) {
  if (!(await schemaIsCurrent(db))) {
    await applySignupSchema(db)
    await db
      .prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .bind(SIGNUP_SCHEMA_META_KEY, signupSchemaVersion())
      .run()
  }
  await afterSignupSchema(db)
}

let cachedSchemaVersion: string | null = null

/**
 * The fingerprint covers every SQL constant below. Bump this when applySignupSchema or
 * migrateCompanionColumns change in code only (new steps, new order), so the DDL pass reruns.
 */
const SCHEMA_CODE_REVISION = 'schema-code-1'

/** Changes whenever any statement the DDL pass runs changes, so a deploy with new DDL reruns it. */
export function signupSchemaVersion() {
  return (cachedSchemaVersion ??= schemaFingerprint([
    SCHEMA_CODE_REVISION, SIGNUPS, BASE_INDEXES, ADD_COLUMNS, COMPANIONS, TAKEN, ABROAD_PRIORITY,
    PRIORITY_SECTIONS_TABLE, PRIORITY_SECTIONS_INDEXES, PARTNER_PEOPLE_TABLE, PARTNER_PEOPLE_INDEXES,
    PARTNER_SECTION_COLUMNS, SIGNED_WAVE_COLUMNS, SIGNING_GENERATED_COLUMNS, PARTNER_WITHDRAWAL_COLUMNS,
    STAFF, AUDIT, INDEXES, RESERVED_SECTION_GUARDS, MOBILE_DRAFTS_TABLE, MOBILE_DRAFTS_GUARDS, PARTNER_SECTION_GUARDS,
    DESIGNATION_NUMBER_UNIQUE_INDEX_SQL, DESIGNATION_HIGH_WATER_TABLE, DESIGNATION_HIGH_WATER_TRIGGERS, DESIGNATION_HIGH_WATER_SEED,
  ]))
}

/** One round trip: is the stored DDL fingerprint the one this build would apply? */
async function schemaIsCurrent(db: SignupD1) {
  try {
    await db.prepare('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run()
    const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(SIGNUP_SCHEMA_META_KEY).first<{ value: string }>()
    return row?.value === signupSchemaVersion()
  } catch {
    return false
  }
}

async function applySignupSchema(db: SignupD1) {
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
  await db.prepare(ABROAD_PRIORITY).run()
  await db.prepare(PRIORITY_SECTIONS_TABLE).run()
  for (const sql of PRIORITY_SECTIONS_INDEXES) await db.prepare(sql).run()
  await db.prepare(PARTNER_PEOPLE_TABLE).run()
  for (const sql of PARTNER_PEOPLE_INDEXES) await db.prepare(sql).run()
  for (const sql of [...PARTNER_SECTION_COLUMNS, ...SIGNED_WAVE_COLUMNS, ...SIGNING_GENERATED_COLUMNS, ...PARTNER_WITHDRAWAL_COLUMNS]) {
    try {
      await db.prepare(sql).run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/duplicate column/i.test(message)) throw error
    }
  }
  await db.prepare(STAFF).run()
  await db.prepare(AUDIT).run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_signup_audit_signup ON signup_audit(signup_id, created_at)').run()
  for (const sql of INDEXES) await db.prepare(sql).run()
  for (const sql of RESERVED_SECTION_GUARDS) await db.prepare(sql).run()
  await db.prepare(MOBILE_DRAFTS_TABLE).run()
  for (const sql of MOBILE_DRAFTS_GUARDS) await db.prepare(sql).run()
  for (const sql of PARTNER_SECTION_GUARDS) await db.prepare(sql).run()
  try {
    await db.prepare(DESIGNATION_NUMBER_UNIQUE_INDEX_SQL).run()
  } catch {
    // Applied by sql/2026-10-19-designation-number-per-mir.sql; never block requests on it.
  }
  // Numbers are never reused: the per-МИР high-water mark (table first, the assign SQL reads it).
  await db.prepare(DESIGNATION_HIGH_WATER_TABLE).run()
  for (const sql of [...DESIGNATION_HIGH_WATER_TRIGGERS, ...DESIGNATION_HIGH_WATER_SEED]) {
    try {
      await db.prepare(sql).run()
    } catch (error) {
      console.warn('designation high-water', error instanceof Error ? error.message : error)
    }
  }
}

async function afterSignupSchema(db: SignupD1) {
  const now = new Date().toISOString()
  for (const email of parseAdminEmails((env as unknown as { ADMIN_EMAILS?: string }).ADMIN_EMAILS)) {
    await db.prepare(`INSERT INTO staff (email, role, invited_by, created_at) VALUES (?, 'admin', 'env', ?) ON CONFLICT(email) DO NOTHING`).bind(email, now).run()
  }
  await ensureSearchIndex(db)
  // Once per isolate: withdrawn people who still hold a seat (the old /profil withdraw) get it freed,
  // with an audit line and the Brevo cleanup. Idempotent; never blocks a request.
  const sweep = (withdrawnSweep ??= withDeadline(releaseWithdrawnSections(db, now), WITHDRAWN_SWEEP_DEADLINE_MS, 'releaseWithdrawnSections').catch((error) => {
    console.warn('releaseWithdrawnSections failed', error instanceof Error ? error.message : error)
    // A failed or stuck sweep is retried by a later bootstrap instead of being cached forever.
    if (withdrawnSweep === sweep) withdrawnSweep = null
  }))
  await sweep
}

let withdrawnSweep: Promise<unknown> | null = null

export function profileFrom(row: SignupRow): Profile {
  const parsed = JSON.parse(row.payload) as Partial<Profile> & { draftSection?: unknown; demoState?: unknown }
  delete parsed.draftSection
  delete parsed.assignedSection
  delete parsed.demoState
  const profile = {
    ...emptyProfile(),
    ...parsed,
    referralCode: row.referral_code ?? parsed.referralCode ?? '',
    referredBy: row.referred_by ?? parsed.referredBy ?? null,
    source: row.source ?? parsed.source ?? null,
    egn: row.egn || parsed.egn || '',
    assignedSection: visibleSection(row.published_section),
  }
  // Drop a can't-reach flag that no longer matches the published section.
  return normalizeCantReachSection(profile)
}

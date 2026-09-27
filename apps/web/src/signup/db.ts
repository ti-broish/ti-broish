import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { emptyProfile, type Profile } from './model'
import { companionRows, egnProblem, signupColumns } from './record'

const COOKIE = 'tb_session'

const SCHEMA = `
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
);
CREATE INDEX IF NOT EXISTS idx_signups_referral ON signups(referral_code);
CREATE INDEX IF NOT EXISTS idx_signups_session ON signups(session_token);
`

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

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_signups_source ON signups(source)',
  'CREATE INDEX IF NOT EXISTS idx_signups_mir ON signups(mir_code)',
  'CREATE INDEX IF NOT EXISTS idx_signups_role ON signups(role)',
  'CREATE INDEX IF NOT EXISTS idx_companions_signup ON companions(signup_id)',
]

type Row = {
  id: string
  payload: string
  referral_code: string | null
  referred_by: string | null
  source: string | null
  egn: string | null
}

async function database() {
  const db = (env as unknown as { DB?: SignupD1 }).DB
  if (!db) return null
  await db.exec(SCHEMA)
  for (const sql of ADD_COLUMNS) {
    try {
      await db.prepare(sql).run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/duplicate column/i.test(message)) throw error
    }
  }
  await db.prepare(COMPANIONS).run()
  for (const sql of INDEXES) await db.prepare(sql).run()
  return db
}

interface SignupD1 {
  prepare(sql: string): {
    run(): Promise<unknown>
    bind(...values: unknown[]): {
      run(): Promise<unknown>
      first<T>(): Promise<T | null>
    }
  }
  exec(sql: string): Promise<unknown>
}

function profileFrom(row: Row): Profile {
  const parsed = JSON.parse(row.payload) as Partial<Profile>
  return {
    ...emptyProfile(),
    ...parsed,
    referralCode: row.referral_code ?? parsed.referralCode ?? '',
    referredBy: row.referred_by ?? parsed.referredBy ?? null,
    source: row.source ?? parsed.source ?? null,
    egn: row.egn || parsed.egn || '',
  }
}

async function referrerName(db: NonNullable<Awaited<ReturnType<typeof database>>>, code: string | null) {
  if (!code) return null
  const row = await db
    .prepare('SELECT payload FROM signups WHERE referral_code = ?')
    .bind(code)
    .first<{ payload: string }>()
  if (!row) return null
  const profile = JSON.parse(row.payload) as Partial<Profile>
  return [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null
}

export const saveSignup = createServerFn({ method: 'POST' })
  .validator((profile: Profile) => profile)
  .handler(async ({ data }) => {
    const db = await database()
    if (!db || !data.email.trim()) return { ok: false as const, message: 'Няма запис.' }
    const problem = egnProblem(data.egn)
    if (problem) return { ok: false as const, message: problem }
    const now = new Date().toISOString()
    const columns = signupColumns(data)
    const existing = await db.prepare('SELECT id, session_token FROM signups WHERE email = ?').bind(columns.email).first<{ id: string; session_token: string | null }>()
    const id = existing?.id ?? crypto.randomUUID()
    const token = existing?.session_token ?? crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO signups (
           id, email, session_token, referral_code, referred_by, source, egn, role,
           rounds_first, rounds_runoff, experience, region_code, mir_code, municipality_name, town_name,
           city_region_code, city_region_name, section_place, paper_count, machine_count, radius,
           extra_city_regions, distant_region_codes, travel_municipalities, has_car, car_seats, has_drone,
           coordinator, payload, email_confirmed, consent, submitted, withdrawn, notes, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           session_token = excluded.session_token,
           referral_code = excluded.referral_code,
           referred_by = COALESCE(signups.referred_by, excluded.referred_by),
           source = COALESCE(signups.source, excluded.source),
           egn = COALESCE(NULLIF(excluded.egn, ''), signups.egn),
           role = excluded.role,
           rounds_first = excluded.rounds_first,
           rounds_runoff = excluded.rounds_runoff,
           experience = excluded.experience,
           region_code = excluded.region_code,
           mir_code = excluded.mir_code,
           municipality_name = excluded.municipality_name,
           town_name = excluded.town_name,
           city_region_code = excluded.city_region_code,
           city_region_name = excluded.city_region_name,
           section_place = excluded.section_place,
           paper_count = excluded.paper_count,
           machine_count = excluded.machine_count,
           radius = excluded.radius,
           extra_city_regions = excluded.extra_city_regions,
           distant_region_codes = excluded.distant_region_codes,
           travel_municipalities = excluded.travel_municipalities,
           has_car = excluded.has_car,
           car_seats = excluded.car_seats,
           has_drone = excluded.has_drone,
           coordinator = excluded.coordinator,
           payload = excluded.payload,
           email_confirmed = excluded.email_confirmed,
           consent = excluded.consent,
           submitted = excluded.submitted,
           withdrawn = excluded.withdrawn,
           notes = excluded.notes,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        columns.email,
        token,
        data.referralCode || null,
        columns.referredBy,
        columns.source,
        columns.egn,
        columns.role,
        columns.roundsFirst,
        columns.roundsRunoff,
        columns.experience,
        columns.regionCode,
        columns.mirCode,
        columns.municipalityName,
        columns.townName,
        columns.cityRegionCode,
        columns.cityRegionName,
        columns.sectionPlace,
        columns.paperCount,
        columns.machineCount,
        columns.radius,
        columns.extraCityRegions,
        columns.distantRegionCodes,
        columns.travelMunicipalities,
        columns.hasCar,
        columns.carSeats,
        columns.hasDrone,
        columns.coordinator,
        columns.payload,
        columns.emailConfirmed,
        columns.consent,
        columns.submitted,
        columns.withdrawn,
        columns.notes,
        now,
        now,
      )
      .run()
    await db.prepare('DELETE FROM companions WHERE signup_id = ?').bind(id).run()
    for (const person of companionRows(data.companions)) {
      await db
        .prepare(
          `INSERT INTO companions (id, signup_id, in_group, first_name, middle_name, last_name, email, phone, role, same_place)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(person.id || crypto.randomUUID(), id, person.inGroup, person.firstName, person.middleName, person.lastName, person.email, person.phone, person.role, person.samePlace)
        .run()
    }
    setCookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 180 })
    const countRow = data.referralCode
      ? await db.prepare('SELECT COUNT(*) AS n FROM signups WHERE referred_by = ?').bind(data.referralCode).first<{ n: number }>()
      : null
    return { ok: true as const, referrerName: await referrerName(db, columns.referredBy), referralCount: countRow?.n ?? 0 }
  })

export const loadSignup = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await database()
  const token = getCookie(COOKIE)
  if (!db || !token) return null
  const row = await db
    .prepare('SELECT id, payload, referral_code, referred_by, source, egn FROM signups WHERE session_token = ?')
    .bind(token)
    .first<Row>()
  if (!row) return null
  const profile = profileFrom(row)
  const countRow = profile.referralCode
    ? await db.prepare('SELECT COUNT(*) AS n FROM signups WHERE referred_by = ?').bind(profile.referralCode).first<{ n: number }>()
    : null
  return {
    profile,
    referrerName: await referrerName(db, profile.referredBy),
    referralCount: countRow?.n ?? 0,
  }
})

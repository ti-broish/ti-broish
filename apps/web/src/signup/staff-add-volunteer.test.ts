import { beforeEach, describe, expect, it, vi } from 'vitest'

// Nothing here may send mail: if the module ever reached the mailer, these spies would see it.
const mail = vi.hoisted(() => ({ deliverMail: vi.fn(), sendSignupReceipt: vi.fn(), importConfirmMail: vi.fn() }))
vi.mock('./mail', () => mail)

import type { SignupD1 } from './db-core'
import { isPlaceholderEmail } from './designation-section-sql'
import type { HomePlace } from './model'
import { PARTNER_PEOPLE_TABLE } from './partner-people-sql'
import { roleAllows } from './staff'
import {
  ADD_VOLUNTEER_ACTION,
  addStaffVolunteer,
  addVolunteerProblem,
  parseAddVolunteerInput,
  placeholderEmail,
  staffNoteFor,
  volunteerMir,
} from './staff-add-volunteer'

// Synthetic test data only: made-up names and ЕГН built here with a valid checksum.
function egn(stem: string) {
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...stem].reduce((total, digit, index) => total + Number(digit) * weights[index], 0)
  return `${stem}${(sum % 11) % 10}`
}

const ADULT = egn('800101123')
const OTHER_ADULT = egn('850505456')
const UNDERAGE = egn('104101789') // 01.01.2010

const VARNA: HomePlace = { regionCode: '03', regionName: 'Варна', municipalityCode: 'VAR06', municipalityName: 'Варна', townId: 10135, townName: 'Варна' }
const SOFIA_NO_DISTRICT: HomePlace = { regionCode: 'sofia-merged', regionName: 'София', municipalityCode: 'SOF46', municipalityName: 'Столична', townId: 68134, townName: 'София' }

// „Без имейл“ is ticked unless the test types an e-mail.
const base = (over: Record<string, unknown> = {}) =>
  parseAddVolunteerInput({ firstName: 'Тест', middleName: 'Пробов', lastName: 'Тестов', egn: ADULT, email: '', noEmail: !over.email, phone: '', note: '', place: VARNA, ...over })

describe('add volunteer: validation', () => {
  it('needs the editor right, not view only', () => {
    expect(ADD_VOLUNTEER_ACTION).toBe('edit')
    expect(roleAllows('viewer', ADD_VOLUNTEER_ACTION)).toBe(false)
    expect(roleAllows(null, ADD_VOLUNTEER_ACTION)).toBe(false)
    expect(roleAllows('editor', ADD_VOLUNTEER_ACTION)).toBe(true)
    expect(roleAllows('admin', ADD_VOLUNTEER_ACTION)).toBe(true)
  })

  it('accepts names, ЕГН and place only when „Без имейл“ is ticked', () => {
    expect(addVolunteerProblem(base())).toBeNull()
  })

  it('needs an e-mail or the „Без имейл“ tick', () => {
    expect(addVolunteerProblem(base({ noEmail: false }))).toMatch(/Без имейл/)
    expect(addVolunteerProblem(base({ noEmail: false, email: 'a@example.org' }))).toBeNull()
  })

  it('drops a typed e-mail when „Без имейл“ is ticked', () => {
    const input = base({ email: 'typed@example.org', noEmail: true })
    expect(input).toMatchObject({ email: '', noEmail: true })
    expect(addVolunteerProblem(input)).toBeNull()
  })

  it('cleans the input', () => {
    const input = base({ firstName: '  Тест ', egn: '80 01 01 123x', email: ' A@Example.ORG ', allowNameMatch: 'yes' })
    expect(input.firstName).toBe('Тест')
    expect(input.egn).toBe('800101123')
    expect(input.email).toBe('a@example.org')
    expect(input.allowNameMatch).toBe(false)
  })

  it('refuses missing names, bad or underage ЕГН, a missing place, bad e-mail or phone', () => {
    expect(addVolunteerProblem(base({ middleName: '' }))).toMatch(/трите имена/)
    expect(addVolunteerProblem(base({ lastName: 'Smith' }))).toMatch(/кирилица/)
    expect(addVolunteerProblem(base({ egn: '123' }))).toMatch(/10 цифри/)
    expect(addVolunteerProblem(base({ egn: `${ADULT.slice(0, 9)}${(Number(ADULT[9]) + 1) % 10}` }))).toMatch(/не е валидно/)
    expect(addVolunteerProblem(base({ egn: UNDERAGE }))).toMatch(/18 години/)
    expect(addVolunteerProblem(base({ place: null }))).toMatch(/населеното място/)
    expect(addVolunteerProblem(base({ place: SOFIA_NO_DISTRICT }))).toMatch(/района/)
    expect(addVolunteerProblem(base({ email: 'not-an-email' }))).toMatch(/Имейлът/)
    expect(addVolunteerProblem(base({ email: 'bez-imeil-abc@tibroish.invalid' }))).toMatch(/Имейлът/)
    expect(addVolunteerProblem(base({ phone: '12' }))).toMatch(/Телефонът/)
    expect(addVolunteerProblem(base({ phone: '0888 123 456' }))).toBeNull()
  })

  it('gets the МИР from the place, 32 abroad', () => {
    expect(volunteerMir(VARNA)).toBe('03')
    expect(volunteerMir({ ...SOFIA_NO_DISTRICT, cityRegionCode: '02', cityRegionName: 'Средец' })).toMatch(/^2[3-5]$/)
    expect(volunteerMir({ regionCode: '32', regionName: 'Извън страната', countryCode: 'DE', countryName: 'Германия', townName: 'Берлин' })).toBe('32')
  })

  it('makes a unique stand-in address that is never a real e-mail', () => {
    const first = placeholderEmail()
    expect(first).toMatch(/^bez-imeil-[a-z0-9]{8}@tibroish\.invalid$/)
    expect(isPlaceholderEmail(first)).toBe(true)
    const many = new Set(Array.from({ length: 200 }, () => placeholderEmail()))
    expect(many.size).toBe(200)
  })

  it('writes who added the person and what is missing in the note', () => {
    const at = new Date('2026-10-24T10:00:00.000Z')
    expect(staffNoteFor({ note: 'Обади се по телефона.', phone: '' }, true, at)).toBe(
      'Обади се по телефона. Добавен от екипа в админа („Добави доброволец“) на 24.10.2026. Няма имейл: адресът е заместител (@tibroish.invalid), не е истински. Няма телефон.',
    )
    expect(staffNoteFor({ note: '', phone: '0888123456' }, false, at)).toBe('Добавен от екипа в админа („Добави доброволец“) на 24.10.2026.')
  })
})

type Sqlite = {
  exec(sql: string): void
  prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }
}

async function openDb(): Promise<Sqlite | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Sqlite }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

function asD1(db: Sqlite): SignupD1 {
  const statement = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => (db.prepare(sql).get(...args) ?? null) as T | null,
    all: async <T>() => ({ results: db.prepare(sql).all(...args) as T[] }),
    run: async () => {
      db.prepare(sql).run(...args)
      return { success: true }
    },
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: Array<{ sql: string; args: unknown[] }>) => {
      db.exec('BEGIN')
      try {
        for (const item of list) db.prepare(item.sql).run(...item.args)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return []
    },
    exec: async (sql: string) => db.exec(sql),
  } as unknown as SignupD1
}

const sqlite = await openDb()

// The signups columns this insert touches, as in db-core.ts (which cannot load outside the Worker).
const SIGNUPS = `CREATE TABLE signups (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, session_token TEXT UNIQUE, referral_code TEXT UNIQUE,
  referred_by TEXT, payload TEXT NOT NULL, email_confirmed INTEGER NOT NULL DEFAULT 0, withdrawn INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source TEXT, egn TEXT, role TEXT, rounds_first INTEGER, rounds_runoff INTEGER,
  experience TEXT, region_code TEXT, mir_code TEXT, municipality_name TEXT, town_name TEXT, city_region_code TEXT,
  city_region_name TEXT, section_place TEXT, paper_count INTEGER, machine_count INTEGER, radius TEXT, extra_city_regions TEXT,
  distant_region_codes TEXT, travel_municipalities TEXT, has_car INTEGER, car_seats INTEGER, has_drone INTEGER,
  coordinator INTEGER NOT NULL DEFAULT 0, consent INTEGER NOT NULL DEFAULT 0, submitted INTEGER NOT NULL DEFAULT 0, notes TEXT,
  draft_locked INTEGER NOT NULL DEFAULT 0, imported INTEGER NOT NULL DEFAULT 0, signup_mail_at TEXT, staff_note TEXT
)`
const AUDIT = `CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT NOT NULL, actor TEXT NOT NULL, field TEXT NOT NULL,
  before_text TEXT NOT NULL, after_text TEXT NOT NULL, created_at TEXT NOT NULL)`

describe.skipIf(!sqlite)('add volunteer (SQLite, as D1)', () => {
  const raw = sqlite!
  const db = asD1(raw)
  const ACTOR = 'staff@example.org'

  beforeEach(() => {
    mail.deliverMail.mockClear()
    for (const table of ['signups', 'signup_audit', 'partner_people']) raw.exec(`DROP TABLE IF EXISTS ${table}`)
    raw.exec(SIGNUPS)
    raw.exec(AUDIT)
    raw.exec(PARTNER_PEOPLE_TABLE)
  })

  const row = (id: string) => raw.prepare('SELECT * FROM signups WHERE id = ?').get(id) as Record<string, unknown>

  it('creates a finished section signup with a stand-in e-mail, a note and an audit line, and sends nothing', async () => {
    const result = await addStaffVolunteer(db, base(), ACTOR, new Date('2026-10-24T10:00:00.000Z'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.placeholder).toBe(true)
    expect(result.mir).toBe('03')
    expect(result.link).toBe(`/admin/signups/${result.id}`)
    expect(result.message).toMatch(/без имейл/)
    expect(result.message).toMatch(/Brevo/)
    const saved = row(result.id)
    expect(saved).toMatchObject({
      email: result.email,
      email_confirmed: 1,
      withdrawn: 0,
      source: 'admin-list',
      egn: ADULT,
      role: 'section',
      rounds_first: 1,
      rounds_runoff: 1,
      region_code: '03',
      mir_code: '03',
      town_name: 'Варна',
      radius: 'settlement',
      consent: 1,
      submitted: 1,
      imported: 0,
      signup_mail_at: 'skipped',
      draft_locked: 0,
      referred_by: null,
    })
    expect(isPlaceholderEmail(String(saved.email))).toBe(true)
    expect(String(saved.referral_code)).toHaveLength(6)
    expect(saved.session_token).toBeTruthy()
    expect(String(saved.staff_note)).toMatch(/заместител/)
    const payload = JSON.parse(String(saved.payload))
    expect(payload).toMatchObject({ firstName: 'Тест', emailConfirmed: true, submitted: true, consent: true, role: 'section', source: 'admin-list', egn: '' })
    expect(payload.rounds).toEqual({ first: true, runoff: true })
    const audit = raw.prepare('SELECT * FROM signup_audit WHERE signup_id = ?').all(result.id) as Record<string, unknown>[]
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor: ACTOR, field: 'staff_note', before_text: '', after_text: saved.staff_note })
    expect(mail.deliverMail).not.toHaveBeenCalled()
    expect(mail.sendSignupReceipt).not.toHaveBeenCalled()
  })

  it('keeps a real e-mail and phone when given', async () => {
    const result = await addStaffVolunteer(db, base({ email: 'Volunteer@Example.org', phone: '0888123456' }), ACTOR)
    expect(result.ok && result.placeholder).toBe(false)
    if (!result.ok) return
    expect(row(result.id).email).toBe('volunteer@example.org')
    expect(JSON.parse(String(row(result.id).payload)).phone).toBe('0888123456')
  })

  it('refuses the same ЕГН in signups, with a link to the record', async () => {
    const first = await addStaffVolunteer(db, base(), ACTOR)
    if (!first.ok) throw new Error('first add failed')
    const again = await addStaffVolunteer(db, base({ firstName: 'Друго', allowNameMatch: true }), ACTOR)
    expect(again).toMatchObject({ ok: false, reason: 'duplicate', existing: { kind: 'signup', id: first.id, link: `/admin/signups/${first.id}` } })
    if (!again.ok) expect(again.message).toMatch(/ЕГН/)
    expect(raw.prepare('SELECT COUNT(*) AS n FROM signups').get()).toEqual({ n: 1 })
  })

  it('refuses an ЕГН already in „И аз“ (partner_people)', async () => {
    raw
      .prepare(`INSERT INTO partner_people (id, partner, egn, first_name, middle_name, last_name, imported_at, updated_at) VALUES ('pp-x', 'iaz', ?, 'Друг', 'Човек', 'Някой', 'x', 'x')`)
      .run(` ${ADULT} `)
    const result = await addStaffVolunteer(db, base(), ACTOR)
    expect(result).toMatchObject({ ok: false, reason: 'duplicate', existing: { kind: 'partner', id: 'pp-x', link: '/admin/iaz/pp-x' } })
    expect(raw.prepare('SELECT COUNT(*) AS n FROM signups').get()).toEqual({ n: 0 })
  })

  it('refuses an e-mail that is already used', async () => {
    const first = await addStaffVolunteer(db, base({ email: 'same@example.org' }), ACTOR)
    expect(first.ok).toBe(true)
    const again = await addStaffVolunteer(db, base({ egn: OTHER_ADULT, firstName: 'Друго', email: 'SAME@example.org' }), ACTOR)
    expect(again).toMatchObject({ ok: false, reason: 'duplicate' })
    if (!again.ok) expect(again.message).toMatch(/имейл/)
  })

  it('warns on the same three names, then adds when staff confirm', async () => {
    const first = await addStaffVolunteer(db, base(), ACTOR)
    if (!first.ok) throw new Error('first add failed')
    const warned = await addStaffVolunteer(db, base({ egn: OTHER_ADULT }), ACTOR)
    expect(warned).toMatchObject({ ok: false, reason: 'name-match', matches: [{ kind: 'signup', id: first.id }] })
    const added = await addStaffVolunteer(db, base({ egn: OTHER_ADULT, allowNameMatch: true }), ACTOR)
    expect(added.ok).toBe(true)
    expect(raw.prepare('SELECT COUNT(*) AS n FROM signups').get()).toEqual({ n: 2 })
  })

  it('writes nothing for invalid input', async () => {
    const result = await addStaffVolunteer(db, base({ egn: UNDERAGE }), ACTOR)
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(raw.prepare('SELECT COUNT(*) AS n FROM signups').get()).toEqual({ n: 0 })
    expect(raw.prepare('SELECT COUNT(*) AS n FROM signup_audit').get()).toEqual({ n: 0 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { SignupD1 } from './db-core'
import {
  EGN_TAKEN_SQL,
  HISTORY_REPLACED_SQL,
  afterReset,
  applyIdentityFix,
  checkIdentityFix,
  designationLinkBrevoEligible,
  fixStage,
  loadStoredIdentity,
  resetPlan,
  type FileState,
} from './identity-fix'
import { OPEN_RIK_CORRECTIONS_SQL, openCorrectionsFromRows } from './signed-waves.server'
import { rikCorrectionRowFor, type SignedPerson } from './signed-waves'
import { signScopeWhere } from './designation-sign-scope'

vi.mock('cloudflare:workers', () => ({ env: {} }))

/** A valid ЕГН for a date (born 1990-1999): checksum digit computed. */
function egn(prefix9: string) {
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = prefix9.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index]!, 0)
  const check = sum % 11 === 10 ? 0 : sum % 11
  return `${prefix9}${check}`
}

const OLD_EGN = egn('900101123')
const NEW_EGN = egn('910202456')

type Raw = { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): { changes: number | bigint }; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } }

async function openDb(): Promise<{ raw: Raw; db: SignupD1 } | null> {
  let raw: Raw
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Raw }
    raw = new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
  const designation = `designation_number INTEGER, designation_mir TEXT, designation_generated_at TEXT, designation_signing_generated_at TEXT,
    designation_signed_at TEXT, designation_first_signed_at TEXT, designation_drive_file_id TEXT, designation_pdf_url TEXT, updated_at TEXT`
  raw.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, email TEXT, payload TEXT, egn TEXT, withdrawn INTEGER DEFAULT 0, ${designation})`)
  raw.exec(`CREATE TABLE partner_people (id TEXT PRIMARY KEY, partner TEXT, email TEXT, egn TEXT, first_name TEXT, middle_name TEXT, last_name TEXT,
    withdrawn_at TEXT, ${designation}, UNIQUE (partner, egn))`)
  raw.exec(`CREATE TABLE signup_audit (id TEXT PRIMARY KEY, signup_id TEXT, actor TEXT, field TEXT, before_text TEXT, after_text TEXT, created_at TEXT)`)
  raw.exec(`CREATE TABLE rik_sources (mir TEXT PRIMARY KEY, submitted_at TEXT)`)
  raw.exec(`CREATE TABLE rik_entries (id TEXT PRIMARY KEY, mir TEXT, ours INTEGER, number INTEGER, missing_since TEXT)`)
  raw.exec(`CREATE TABLE rik_status (person_id TEXT PRIMARY KEY, status TEXT)`)
  raw.exec(`CREATE TABLE rik_tasks (id TEXT PRIMARY KEY, person_id TEXT, done_at TEXT, done_by TEXT, fixed_at TEXT, fixed_by TEXT)`)
  const statement = (sql: string, binds: unknown[] = []): ReturnType<SignupD1['prepare']> & { exec(): unknown } => ({
    bind: (...values: unknown[]) => statement(sql, values),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...binds).changes) } }),
    first: async <T,>() => (raw.prepare(sql).get(...binds) as T) ?? null,
    all: async <T,>() => ({ results: raw.prepare(sql).all(...binds) as T[] }),
    exec: () => raw.prepare(sql).run(...binds),
  })
  const db: SignupD1 = {
    prepare: (sql: string) => statement(sql),
    // D1 batches are one transaction: all or nothing.
    batch: async (statements) => {
      raw.exec('BEGIN')
      try {
        for (const item of statements) (item as unknown as { exec(): unknown }).exec()
        raw.exec('COMMIT')
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
      return []
    },
  }
  return { raw, db }
}

const SIGNED = {
  designation_number: 7,
  designation_mir: '23',
  designation_generated_at: '2026-10-21T08:00:00.000Z',
  designation_signing_generated_at: '2026-10-21T09:00:00.000Z',
  designation_signed_at: '2026-10-21T12:00:00.000Z',
  designation_first_signed_at: '2026-10-21T12:00:00.000Z',
  designation_drive_file_id: 'file-old',
  designation_pdf_url: 'https://drive.google.com/file/d/file-old/view',
}

function seedSignup(raw: Raw, id: string, overrides: Partial<typeof SIGNED> = {}) {
  const row = { ...SIGNED, ...overrides }
  raw
    .prepare(`INSERT INTO signups (id, email, payload, egn, designation_number, designation_mir, designation_generated_at, designation_signing_generated_at,
      designation_signed_at, designation_first_signed_at, designation_drive_file_id, designation_pdf_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      `${id}@example.com`,
      JSON.stringify({ firstName: 'Иван', middleName: 'Петров', lastName: 'Иванов', phone: '0888' }),
      OLD_EGN,
      row.designation_number,
      row.designation_mir,
      row.designation_generated_at,
      row.designation_signing_generated_at,
      row.designation_signed_at,
      row.designation_first_signed_at,
      row.designation_drive_file_id,
      row.designation_pdf_url,
    )
}

const state = (patch: Partial<FileState> = {}): FileState => ({
  number: 7,
  mir: '23',
  generatedAt: SIGNED.designation_generated_at,
  signingGeneratedAt: SIGNED.designation_signing_generated_at,
  signedAt: SIGNED.designation_signed_at,
  firstSignedAt: SIGNED.designation_first_signed_at,
  driveFileId: 'file-old',
  pdfUrl: SIGNED.designation_pdf_url,
  ...patch,
})

describe('checkIdentityFix', () => {
  const current = { firstName: 'Иван', middleName: 'Петров', lastName: 'Иванов', egn: OLD_EGN }

  it('accepts a new name with the stored ЕГН (empty ЕГН field keeps it)', () => {
    const check = checkIdentityFix({ firstName: ' Йван ', middleName: 'Петров', lastName: 'Иванов', egn: '' }, current)
    expect(check).toMatchObject({ ok: true, nameChanged: true, egnChanged: false, after: { firstName: 'Йван', egn: OLD_EGN } })
  })

  it('accepts a valid new ЕГН and rejects a bad checksum', () => {
    expect(checkIdentityFix({ ...current, egn: NEW_EGN }, current)).toMatchObject({ ok: true, egnChanged: true, nameChanged: false })
    const bad = `${NEW_EGN.slice(0, 9)}${(Number(NEW_EGN[9]) + 1) % 10}`
    expect(checkIdentityFix({ ...current, egn: bad }, current)).toMatchObject({ ok: false, message: expect.stringContaining('контролната цифра') })
    expect(checkIdentityFix({ ...current, egn: '12345' }, current)).toMatchObject({ ok: false, message: 'ЕГН трябва да е 10 цифри.' })
  })

  it('refuses no change, missing names, digits in names and underage', () => {
    expect(checkIdentityFix({ ...current, egn: '' }, current)).toMatchObject({ ok: false, message: expect.stringContaining('Нищо не е променено') })
    expect(checkIdentityFix({ ...current, lastName: ' ' }, current)).toMatchObject({ ok: false })
    expect(checkIdentityFix({ ...current, firstName: 'Ив4н' }, current)).toMatchObject({ ok: false })
    // Born 2015 (month + 40): under 18 on election day.
    expect(checkIdentityFix({ ...current, egn: egn('154101123') }, current)).toMatchObject({ ok: false, message: expect.stringContaining('18') })
  })
})

describe('reset state machine', () => {
  it('a signed file is superseded, the marks cleared; a task always means a РИК correction', () => {
    const plan = resetPlan(state(), { mirSubmittedAt: null, inRegister: false }, true)
    expect(plan).toEqual({ resign: true, rikCorrection: true, supersede: true })
    expect(afterReset(state(), plan)).toMatchObject({ number: 7, mir: '23', signedAt: null, signingGeneratedAt: null, driveFileId: null, pdfUrl: null, firstSignedAt: SIGNED.designation_first_signed_at })
  })

  it('from the person page: a correction only when the РИК has the old data', () => {
    expect(resetPlan(state(), { mirSubmittedAt: null, inRegister: false }, false)).toMatchObject({ rikCorrection: false, resign: true })
    expect(resetPlan(state(), { mirSubmittedAt: null, inRegister: true }, false)).toMatchObject({ rikCorrection: true })
  })

  it('no document yet: nothing to reset; no number: nothing at all', () => {
    const fresh = state({ generatedAt: null, signingGeneratedAt: null, signedAt: null, firstSignedAt: null, driveFileId: null, pdfUrl: null })
    expect(resetPlan(fresh, { mirSubmittedAt: null, inRegister: false }, false)).toEqual({ resign: false, rikCorrection: false, supersede: false })
    expect(resetPlan(state({ number: null }), { mirSubmittedAt: null, inRegister: true }, true)).toEqual({ resign: false, rikCorrection: false, supersede: false })
  })

  it('stage: чака подпис → свалено за подпис → подписано наново', () => {
    const fixedAt = '2026-10-23T10:00:00.000Z'
    expect(fixStage({ fixedAt: null, signingGeneratedAt: null, signedAt: null })).toBeNull()
    expect(fixStage({ fixedAt, signingGeneratedAt: '2026-10-21T09:00:00.000Z', signedAt: '2026-10-21T12:00:00.000Z' })).toBe('awaiting_signature')
    expect(fixStage({ fixedAt, signingGeneratedAt: '2026-10-23T11:00:00.000Z', signedAt: null })).toBe('in_signing')
    expect(fixStage({ fixedAt, signingGeneratedAt: '2026-10-23T11:00:00.000Z', signedAt: '2026-10-23T12:00:00.000Z' })).toBe('resigned')
  })
})

describe('applyIdentityFix on D1', () => {
  it('stores the names and ЕГН, audits masked, keeps number/МИР, supersedes the file, marks the task, back in „Само новите“', async () => {
    const open = await openDb()
    if (!open) return
    seedSignup(open.raw, 'a')
    open.raw.prepare(`INSERT INTO rik_tasks (id, person_id) VALUES (?, ?)`).run('a:fix_data:name', 'a')
    const stored = await loadStoredIdentity(open.db, 'signups', 'a')
    const check = checkIdentityFix({ firstName: 'Йоан', middleName: 'Петров', lastName: 'Иванов', egn: NEW_EGN }, { ...stored!.names, egn: stored!.egn })
    if (!check.ok) throw new Error(check.message)
    const now = '2026-10-23T10:00:00.000Z'
    const result = await applyIdentityFix(open.db, { stored: stored!, after: check.after, actor: 'admin@example.com', now, taskId: 'a:fix_data:name' })
    expect(result).toMatchObject({ ok: true, number: 7, mir: '23', nameChanged: true, egnChanged: true, plan: { resign: true, supersede: true, rikCorrection: true } })

    const row = open.raw.prepare('SELECT * FROM signups WHERE id = ?').get('a') as Record<string, unknown>
    expect(JSON.parse(String(row.payload))).toMatchObject({ firstName: 'Йоан', middleName: 'Петров', lastName: 'Иванов', phone: '0888' })
    expect(row).toMatchObject({
      egn: NEW_EGN,
      designation_number: 7,
      designation_mir: '23',
      designation_signed_at: null,
      designation_signing_generated_at: null,
      designation_drive_file_id: null,
      designation_pdf_url: null,
      designation_first_signed_at: SIGNED.designation_first_signed_at,
    })
    // Back in „Само новите“ (the default ZIP scope).
    const inNew = open.raw.prepare(`SELECT id FROM signups WHERE ${signScopeWhere('new')}`).all() as Array<{ id: string }>
    expect(inNew.map((item) => item.id)).toEqual(['a'])

    const audit = open.raw.prepare('SELECT field, before_text, after_text FROM signup_audit ORDER BY field').all() as Array<Record<string, string>>
    expect(audit.map((item) => item.field)).toEqual(['designation_resign', 'egn_last4', 'name'])
    const egnAudit = audit.find((item) => item.field === 'egn_last4')!
    expect(egnAudit.before_text).toBe(`••••••${OLD_EGN.slice(-4)}`)
    expect(egnAudit.after_text).toBe(`••••••${NEW_EGN.slice(-4)}`)
    expect(JSON.stringify(audit)).not.toContain(OLD_EGN)
    expect(JSON.stringify(audit)).not.toContain(NEW_EGN)

    const history = open.raw.prepare('SELECT * FROM designation_file_history').all() as Array<Record<string, unknown>>
    expect(history).toEqual([expect.objectContaining({ person_id: 'a', drive_file_id: 'file-old', pdf_url: SIGNED.designation_pdf_url, signed_at: SIGNED.designation_signed_at, reason: 'identity_fix', replaced_at: null })])

    const renames = open.raw.prepare('SELECT * FROM designation_renames').all() as Array<Record<string, unknown>>
    expect(renames).toEqual([expect.objectContaining({ old_name: 'Иван Петров Иванов', new_name: 'Йоан Петров Иванов', old_egn: OLD_EGN, origin: 'identity_fix', rik_correction: 1, resign: 1, task_id: 'a:fix_data:name' })])

    expect(open.raw.prepare('SELECT done_at, fixed_at, fixed_by FROM rik_tasks').get()).toMatchObject({ done_at: null, fixed_at: now, fixed_by: 'admin@example.com' })

    // The signed upload: new file id, the history row points at it.
    open.raw.prepare(`UPDATE signups SET designation_drive_file_id = 'file-new', designation_pdf_url = 'https://drive/new', designation_signed_at = '2026-10-23T12:00:00.000Z' WHERE id = 'a'`).run()
    await open.db.prepare(HISTORY_REPLACED_SQL).bind('file-new', 'https://drive/new', '2026-10-23T12:00:00.000Z', 'a').run()
    expect(open.raw.prepare('SELECT drive_file_id, replaced_by_file_id, replaced_by_url FROM designation_file_history').get()).toEqual({
      drive_file_id: 'file-old',
      replaced_by_file_id: 'file-new',
      replaced_by_url: 'https://drive/new',
    })
    const after = await loadStoredIdentity(open.db, 'signups', 'a')
    expect(fixStage({ fixedAt: now, signingGeneratedAt: after!.file.signingGeneratedAt, signedAt: after!.file.signedAt })).toBe('resigned')
  })

  it('the РИК correction: name until registered, ЕГН until a task is marked done after the fix', async () => {
    const open = await openDb()
    if (!open) return
    seedSignup(open.raw, 'b')
    const stored = await loadStoredIdentity(open.db, 'signups', 'b')
    await applyIdentityFix(open.db, { stored: stored!, after: { ...stored!.names, egn: NEW_EGN }, actor: 'admin@example.com', now: '2026-10-23T10:00:00.000Z', taskId: null })
    open.raw.prepare(`INSERT INTO rik_status (person_id, status) VALUES ('b', 'registered')`).run()
    const rows = () => open.raw.prepare(OPEN_RIK_CORRECTIONS_SQL).all() as Array<{ person_id: string; old_name: string; new_name: string; old_egn: string }>
    // From the person page, not in the register before the fix: no correction needed.
    expect(rows()).toEqual([])

    const c = await openDb()
    if (!c) return
    seedSignup(c.raw, 'c')
    c.raw.prepare(`INSERT INTO rik_tasks (id, person_id) VALUES ('c:fix_data:egn', 'c')`).run()
    const storedC = await loadStoredIdentity(c.db, 'signups', 'c')
    await applyIdentityFix(c.db, { stored: storedC!, after: { ...storedC!.names, egn: NEW_EGN }, actor: 'admin@example.com', now: '2026-10-23T10:00:00.000Z', taskId: 'c:fix_data:egn' })
    const open1 = openCorrectionsFromRows(c.raw.prepare(OPEN_RIK_CORRECTIONS_SQL).all() as never)
    expect(open1.get('c')).toEqual({ oldName: '', oldEgn: OLD_EGN })
    const person: SignedPerson = {
      id: 'c',
      number: 7,
      mir: '23',
      firstName: 'Иван',
      middleName: 'Петров',
      lastName: 'Иванов',
      egn: NEW_EGN,
      issuedAt: '2026-10-21T08:00:00.000Z',
      firstSignedAt: '2026-10-21T12:00:00.000Z',
      driveFileId: 'file-new',
      partner: false,
      correctionEgnFrom: OLD_EGN,
    }
    expect(rikCorrectionRowFor(person, '').name).toBe(`Иван Петров Иванов (ЕГН вместо ${OLD_EGN})`)
    c.raw.prepare(`UPDATE rik_tasks SET done_at = '2026-10-23T13:00:00.000Z'`).run()
    expect(c.raw.prepare(OPEN_RIK_CORRECTIONS_SQL).all()).toEqual([])
  })

  it('„И аз“: the partner row is updated; a duplicate ЕГН in the partner rolls the whole batch back', async () => {
    const open = await openDb()
    if (!open) return
    const insert = open.raw.prepare(`INSERT INTO partner_people (id, partner, email, egn, first_name, middle_name, last_name, designation_number, designation_mir, designation_signed_at, designation_drive_file_id)
      VALUES (?, 'i-az', ?, ?, 'Мария', '', 'Петрова', ?, '23', '2026-10-21T12:00:00.000Z', ?)`)
    insert.run('pp-1', 'm@example.com', OLD_EGN, 8, 'pp-file')
    insert.run('pp-2', 'n@example.com', NEW_EGN, 9, 'pp-file-2')
    expect(await open.db.prepare(EGN_TAKEN_SQL).bind(NEW_EGN, 'pp-1').first()).toMatchObject({ id: 'pp-2', number: 9 })
    const stored = await loadStoredIdentity(open.db, 'partner_people', 'pp-1')
    await expect(applyIdentityFix(open.db, { stored: stored!, after: { ...stored!.names, egn: NEW_EGN }, actor: 'a', now: 'n', taskId: null })).rejects.toThrow(/UNIQUE/)
    expect(open.raw.prepare(`SELECT egn, designation_drive_file_id FROM partner_people WHERE id = 'pp-1'`).get()).toEqual({ egn: OLD_EGN, designation_drive_file_id: 'pp-file' })
    expect(open.raw.prepare('SELECT COUNT(*) AS n FROM designation_file_history').get()).toEqual({ n: 0 })

    await applyIdentityFix(open.db, { stored: stored!, after: { ...stored!.names, lastName: 'Петрова-Иванова', egn: OLD_EGN }, actor: 'a', now: 'n', taskId: null })
    expect(open.raw.prepare(`SELECT last_name, designation_drive_file_id, designation_signed_at FROM partner_people WHERE id = 'pp-1'`).get()).toEqual({
      last_name: 'Петрова-Иванова',
      designation_drive_file_id: null,
      designation_signed_at: null,
    })
  })
})

describe('designationLinkBrevoEligible', () => {
  const base = { id: 's1', partner: false, email: 'a@example.com', withdrawn: false, signed: true, url: 'https://drive/x' }
  it('only a signed, active Ти Броиш signup with a real e-mail', () => {
    expect(designationLinkBrevoEligible(base)).toEqual({ ok: true })
    expect(designationLinkBrevoEligible({ ...base, partner: true })).toEqual({ ok: false, reason: 'partner' })
    expect(designationLinkBrevoEligible({ ...base, id: 'pp-x' })).toEqual({ ok: false, reason: 'partner' })
    expect(designationLinkBrevoEligible({ ...base, withdrawn: true })).toEqual({ ok: false, reason: 'withdrawn' })
    expect(designationLinkBrevoEligible({ ...base, signed: false })).toEqual({ ok: false, reason: 'not_signed' })
    expect(designationLinkBrevoEligible({ ...base, email: 'x@tibroish.invalid' })).toEqual({ ok: false, reason: 'no_email' })
    expect(designationLinkBrevoEligible({ ...base, email: ' ' })).toEqual({ ok: false, reason: 'no_email' })
    expect(designationLinkBrevoEligible({ ...base, url: '' })).toEqual({ ok: false, reason: 'no_link' })
  })
})

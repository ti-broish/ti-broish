// Published section → numbered, into „Само новите“ for signing, Brevo contact for volunteers. Never mail.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mail = vi.hoisted(() => ({ deliverMail: vi.fn(), sendSignupReceipt: vi.fn(), importConfirmMail: vi.fn(), assignmentMail: vi.fn() }))
vi.mock('./mail', () => mail)
vi.mock('cloudflare:workers', () => ({ env: {} }))
vi.mock('@tanstack/react-start/server', () => ({ getCookie: () => '' }))
vi.mock('./admin', () => ({ loadBrevoSectionFieldsForIds: async () => new Map() }))

import { applySignupSchema, type SignupD1 } from './db-core'
import { advancePublished, numberSectionlessVolunteer, runScheduledPublishedAdvance } from './published-pipeline'
import { loadEgnMirConflict } from './egn-mir-conflict'
import { SIGNUP_DESIGNATION_SECTION_SQL } from './designation-section-sql'
import { PIPELINE_COUNTS_SQL, describeAdvance, pipelineCountsFrom } from './published-pipeline-sql'

type Sqlite = {
  exec(sql: string): void
  prepare(sql: string): { run(...args: unknown[]): { changes: number | bigint }; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }
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
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: Array<{ sql: string; args: unknown[] }>) => {
      db.exec('BEGIN')
      try {
        const out = list.map((item) => ({ success: true, meta: { changes: Number(db.prepare(item.sql).run(...item.args).changes) } }))
        db.exec('COMMIT')
        return out
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    exec: async (sql: string) => db.exec(sql),
  } as unknown as SignupD1
}

// Synthetic people only: made-up names, ЕГН built here with a valid checksum.
function egn(stem: string) {
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...stem].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0)
  return `${stem}${(sum % 11) % 10}`
}

const sqlite = await openDb()
const T0 = '2026-10-29T08:00:00.000Z'

type Call = { method: string; url: string; body: unknown }

function fakeBrevo(calls: Call[], status = 204) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url.endsWith('/contacts/attributes')) {
      return new Response(JSON.stringify({ attributes: [{ name: 'FIRSTNAME', category: 'normal', type: 'text' }, { name: 'SECTION_ID_TEXT', category: 'normal', type: 'text' }, { name: 'SECTION_PUBLISHED', category: 'normal', type: 'boolean' }, { name: 'DOCUMENT_URL', category: 'normal', type: 'text' }] }), { status: 200 })
    }
    return new Response(null, { status })
  }) as typeof fetch
}

const sectionFields = async (_db: SignupD1, ids: string[]) =>
  new Map(ids.map((id) => [id, { firstName: 'Тест', lastName: 'Тестов', mir: '23', publishedSection: '234600001', sectionAddress: 'ул. Тестова 1', sectionPlace: 'София', location: 'София', role: 'observer' }]))

const brevo = { apiKey: 'test-key', listId: 95, attribute: 'DOCUMENT_URL' }

describe.skipIf(!sqlite)('published pipeline (SQLite, as D1)', () => {
  let db: SignupD1

  async function signup(id: string, email: string, over: Record<string, unknown> = {}) {
    const row = { egn: null, published_section: null, published_at: null, draft_section: null, mir_code: '23', withdrawn: 0, designation_pdf_url: null, ...over }
    const columns = Object.keys(row)
    await db
      .prepare(`INSERT INTO signups (id, email, payload, email_confirmed, created_at, updated_at, ${columns.join(', ')}) VALUES (?, ?, ?, 1, ?, ?, ${columns.map(() => '?').join(', ')})`)
      .bind(id, email, JSON.stringify({ firstName: 'Тест', lastName: id }), T0, T0, ...Object.values(row))
      .run()
  }

  async function partner(id: string, stem: string, sections: { section_published?: string; section_draft?: string }, over: Record<string, unknown> = {}) {
    const row = { egn: egn(stem), designation_mir: null, ...over }
    const columns = Object.keys(row)
    await db
      .prepare(`INSERT INTO partner_people (id, partner, email, first_name, last_name, imported_at, updated_at, ${columns.join(', ')}) VALUES (?, 'iaz', ?, 'Партньор', ?, ?, ?, ${columns.map(() => '?').join(', ')})`)
      .bind(id, `${id}@example.test`, id, T0, T0, ...Object.values(row))
      .run()
    // Sections only by UPDATE: the insert trigger refuses a row that arrives holding one.
    for (const [column, value] of Object.entries(sections)) await db.prepare(`UPDATE partner_people SET ${column} = ? WHERE id = ?`).bind(value, id).run()
  }

  const number = async (table: string, id: string) =>
    db.prepare(`SELECT designation_number AS n, designation_mir AS mir FROM ${table} WHERE id = ?`).bind(id).first<{ n: number | null; mir: string | null }>()

  beforeEach(async () => {
    const raw = sqlite!
    const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>
    for (const table of tables) raw.exec(`DROP TABLE IF EXISTS "${table.name}"`)
    db = asD1(raw)
    await applySignupSchema(db)
    mail.deliverMail.mockClear()
    await signup('s-pub', 'pub@example.test', { egn: egn('800101123'), published_section: '234600001', published_at: T0 })
    await signup('s-pub-signed', 'signed@example.test', { egn: egn('810202123'), published_section: '234600002', published_at: T0, designation_pdf_url: 'https://drive.example/signed' })
    await signup('s-placeholder', 'x1@tibroish.invalid', { egn: egn('820303123'), published_section: '234600003', published_at: T0 })
    await signup('s-withdrawn', 'gone@example.test', { egn: egn('830404123'), published_section: '234600004', published_at: T0, withdrawn: 1 })
    await signup('s-draft', 'draft@example.test', { egn: egn('840505123'), draft_section: '234600005' })
    await partner('pp-pub', '760101123', { section_published: '254600001' }, { designation_mir: '23' })
    await partner('pp-draft', '770101123', { section_draft: '234600009' }, { designation_mir: '23' })
  })

  it('numbers everyone with a published section and upserts volunteer contacts only', async () => {
    const calls: Call[] = []
    const report = await advancePublished(db, 'all', 'test', { brevo, fetchImpl: fakeBrevo(calls), sectionFields, now: new Date(T0) })

    expect((await number('signups', 's-pub'))?.n).not.toBeNull()
    expect((await number('signups', 's-pub-signed'))?.n).not.toBeNull()
    expect((await number('signups', 's-placeholder'))?.n).not.toBeNull()
    expect((await number('signups', 's-withdrawn'))?.n).toBeNull()
    expect((await number('signups', 's-draft'))?.n).toBeNull()
    // „И аз“: МИР follows the published section before numbering, then numbered there.
    expect(await number('partner_people', 'pp-pub')).toMatchObject({ mir: '25' })
    expect((await number('partner_people', 'pp-pub'))?.n).not.toBeNull()
    // „И аз“ with just a МИР (no published section) is numbered in that МИР: the МИР is enough.
    expect(await number('partner_people', 'pp-draft')).toMatchObject({ mir: '23' })
    expect((await number('partner_people', 'pp-draft'))?.n).not.toBeNull()
    // The МИР already followed the section when it was written (mir-from-section triggers); the
    // pipeline's own МИР step is only a safety net for rows from before the triggers.
    expect(report).toMatchObject({ numbered: 5, numberedPartners: 2, partnersMirSet: 0 })

    const pushes = calls.filter((call) => call.url.includes('/contacts/') && !call.url.endsWith('/attributes'))
    expect(pushes.map((call) => decodeURIComponent(call.url.split('/contacts/')[1]!.split('?')[0]!)).sort()).toEqual(['pub@example.test', 'signed@example.test'])
    for (const call of pushes) expect(call).toMatchObject({ method: 'PUT', body: { listIds: [95] } })
    const signed = pushes.find((call) => call.url.includes('signed%40'))!
    expect((signed.body as { attributes: Record<string, string> }).attributes.DOCUMENT_URL).toBe('https://drive.example/signed')
    expect((signed.body as { attributes: Record<string, string> }).attributes.SECTION_ID_TEXT).toBe('234600001')
    expect((signed.body as { attributes: Record<string, unknown> }).attributes.SECTION_PUBLISHED).toBe(true)
    // Contacts only: no campaign, transactional or SMS endpoint, no mail.
    expect(calls.every((call) => !/smtp|emailCampaigns|smsCampaigns|transactional/.test(call.url))).toBe(true)
    expect(mail.deliverMail).not.toHaveBeenCalled()
    expect(report.brevo).toMatchObject({ synced: 2, failed: 0, left: 0 })
    // In the „Само новите“ signing queue: numbered, unsigned, not zipped yet.
    expect(report.counts).toMatchObject({ volunteersUnnumbered: 0, volunteersToSign: 3, partnersToSign: 2, volunteersBrevoPending: 0 })
  })

  it('is idempotent and re-sends a contact only after a new publish', async () => {
    const calls: Call[] = []
    const deps = { brevo, fetchImpl: fakeBrevo(calls), sectionFields, now: new Date(T0) }
    await advancePublished(db, 'all', 'test', deps)
    const first = calls.length
    const again = await advancePublished(db, 'all', 'test', deps)
    expect(again).toMatchObject({ numbered: 0, partnersMirSet: 0, brevo: { synced: 0 } })
    expect(calls.length).toBe(first)

    const before = await number('signups', 's-pub')
    await db.prepare(`UPDATE signups SET published_section = '234600007', published_at = ? WHERE id = 's-pub'`).bind('2026-10-29T09:00:00.000Z').run()
    const moved = await advancePublished(db, { ids: ['s-pub'] }, 'test', deps)
    expect(moved.brevo.synced).toBe(1)
    expect(moved.numbered).toBe(0)
    expect(await number('signups', 's-pub')).toEqual(before)
  })

  it('scoped to the rows a publish wrote', async () => {
    const calls: Call[] = []
    const report = await advancePublished(db, { ids: ['s-pub', 'pp-pub'] }, 'test', { brevo, fetchImpl: fakeBrevo(calls), sectionFields })
    expect(report).toMatchObject({ numbered: 2, numberedPartners: 1, brevo: { synced: 1 } })
    expect((await number('signups', 's-pub-signed'))?.n).toBeNull()
  })

  it('numbers without Brevo when no key, and leaves contacts for later', async () => {
    const report = await advancePublished(db, 'all', 'test', { brevo: null, sectionFields })
    // 3 published volunteers + pp-pub + pp-draft (МИР only).
    expect(report.numbered).toBe(5)
    expect(report.brevo).toMatchObject({ synced: 0, left: 2, skipped: 'липсва BREVO_API_KEY' })
    expect(describeAdvance(report)).toContain('Brevo: не е пратено')
  })

  it('a failed Brevo call is not marked synced and the cron never throws', async () => {
    const calls: Call[] = []
    const report = await runScheduledPublishedAdvance('7 * * * *', { db, brevo, fetchImpl: fakeBrevo(calls, 400), sectionFields })
    expect(report?.brevo).toMatchObject({ synced: 0, failed: 2 })
    const counts = pipelineCountsFrom(await db.prepare(PIPELINE_COUNTS_SQL).first<Record<string, unknown>>())
    expect(counts.volunteersBrevoPending).toBe(2)
    expect(await runScheduledPublishedAdvance('7 * * * *', { db: null })).toBeNull()
  })

  it('the same ЕГН again in the same МИР is covered by the first-round number: no second number, still synced to Brevo', async () => {
    // First round: an „И аз“ row already holds № 512 in МИР 23. Now the same person signs up again and gets a section in МИР 23.
    await partner('pp-round1', '790909123', { section_published: '234600010' }, { designation_mir: '23', designation_number: 512, designation_issued_at: '21.10.2026' })
    await signup('s-again', 'again@example.test', { egn: egn('790909123'), published_section: '234600011', published_at: T0 })
    const calls: Call[] = []
    const report = await advancePublished(db, 'all', 'test', { brevo, fetchImpl: fakeBrevo(calls), sectionFields, now: new Date(T0) })

    expect((await number('signups', 's-again'))?.n).toBeNull()
    expect(await number('partner_people', 'pp-round1')).toMatchObject({ n: 512, mir: '23' })
    // Not a duplicate problem: the пълномощно is valid in the whole МИР.
    expect(report.skippedDuplicates).toBe(0)
    const pushed = calls.filter((call) => call.url.includes('/contacts/') && !call.url.endsWith('/attributes')).map((call) => call.url)
    expect(pushed.some((url) => url.includes('again%40'))).toBe(true)
    expect(report.counts).toMatchObject({ volunteersUnnumbered: 0, volunteersCovered: 1, volunteersHeldElsewhere: 0, volunteersBrevoPending: 0 })
    // New people in МИР 23 continue above the first-round number; nothing is renumbered.
    expect((await number('signups', 's-pub'))?.n).toBeGreaterThan(512)
  })

  it('the same ЕГН numbered in ANOTHER МИР stays a conflict: no number, no Brevo, apart from „без номер“', async () => {
    await partner('pp-other', '791010123', { section_published: '254600010' }, { designation_mir: '25', designation_number: 501, designation_issued_at: '21.10.2026' })
    await signup('s-other', 'other@example.test', { egn: egn('791010123'), published_section: '234600012', published_at: T0 })
    const calls: Call[] = []
    const report = await advancePublished(db, 'all', 'test', { brevo, fetchImpl: fakeBrevo(calls), sectionFields, now: new Date(T0) })

    expect((await number('signups', 's-other'))?.n).toBeNull()
    expect(await number('partner_people', 'pp-other')).toMatchObject({ n: 501, mir: '25' })
    expect(report.skippedDuplicates).toBe(1)
    const pushed = calls.filter((call) => call.url.includes('/contacts/') && !call.url.endsWith('/attributes')).map((call) => call.url)
    expect(pushed.some((url) => url.includes('other%40'))).toBe(false)
    expect(report.counts).toMatchObject({ volunteersUnnumbered: 0, volunteersCovered: 0, volunteersHeldElsewhere: 1, volunteersBrevoPending: 0 })
  })

  it('counts numbered people without a section like the signing ZIP does', async () => {
    // Numbered by МИР only: a volunteer with no section and an „И аз“ row with no published section.
    await signup('s-nosection', 'nosec@example.test', { egn: egn('850606123'), designation_mir: '23', designation_number: 530, designation_issued_at: '29.10.2026' })
    await partner('pp-nosection', '860606123', {}, { designation_mir: '23', designation_number: 531, designation_issued_at: '29.10.2026' })
    await advancePublished(db, 'all', 'test', { brevo: null, sectionFields, now: new Date(T0) })
    const counts = pipelineCountsFrom(await db.prepare(PIPELINE_COUNTS_SQL).first<Record<string, unknown>>())
    // 4 published volunteers (3 numbered, the withdrawn one not) + 1 without a section; partners: pp-pub, pp-draft (МИР only) + the sectionless one.
    expect(counts).toMatchObject({ volunteersNumbered: 4, volunteersNumberedNoSection: 1, partnersNumbered: 3, partnersNumberedNoSection: 2 })
    expect(counts.volunteersToSign + counts.partnersToSign).toBe(7)
  })

  it('loadEgnMirConflict reads other rows with the same ЕГН from both tables', async () => {
    await partner('pp-held', '792020123', { section_published: '254600011' }, { designation_mir: '25', designation_number: 507, designation_issued_at: '21.10.2026' })
    await signup('s-held', 'held@example.test', { egn: egn('792020123') })
    expect(await loadEgnMirConflict(db, 's-held', '254600099')).toBeNull()
    expect(await loadEgnMirConflict(db, 's-held', '234600099')).toMatchObject({ number: 507, mir: '25', partner: true, sectionMir: '23' })
    // The holder's own row is never a conflict with itself.
    expect(await loadEgnMirConflict(db, 'pp-held', '234600099')).toBeNull()
    await db.prepare(`UPDATE partner_people SET withdrawn_at = ? WHERE id = 'pp-held'`).bind(T0).run()
    expect(await loadEgnMirConflict(db, 's-held', '234600099')).toBeNull()
  })

  it('caps one run and reports the rest', async () => {
    const calls: Call[] = []
    const report = await advancePublished(db, 'all', 'test', { brevo, fetchImpl: fakeBrevo(calls), sectionFields, brevoLimit: 1 })
    expect(report.brevo).toMatchObject({ synced: 1, left: 1 })
  })

  describe('volunteers without an e-mail („Без имейл“)', () => {
    const finished = { submitted: 1 }

    it('are numbered by МИР without a section, never go to Brevo, and land in the signing list', async () => {
      await signup('s-noemail', 'bez-imeil-abcd1234@tibroish.invalid', { ...finished, egn: egn('750505123'), mir_code: '03' })
      await signup('s-noemail-blank', '', { ...finished, egn: egn('760606123'), mir_code: '3' })
      await signup('s-real-nosection', 'real@example.test', { ...finished, egn: egn('770707123'), mir_code: '03' })
      await signup('s-noemail-sofia', 'bez-imeil-sofia000@tibroish.invalid', { ...finished, egn: egn('780808123'), mir_code: '', region_code: 'sofia-merged' })
      await signup('s-noemail-started', 'bez-imeil-start000@tibroish.invalid', { egn: egn('790101123'), mir_code: '03' })
      const calls: Call[] = []
      const report = await advancePublished(db, 'all', 'cron', { brevo, fetchImpl: fakeBrevo(calls), sectionFields, now: new Date(T0) })

      const first = await number('signups', 's-noemail')
      expect(first).toMatchObject({ mir: '03' })
      expect(first?.n).toBeGreaterThan(500)
      expect(await number('signups', 's-noemail-blank')).toMatchObject({ n: first!.n! + 1, mir: '03' })
      // With an e-mail the МИР is enough too; never sent to Brevo without a section.
      expect(await number('signups', 's-real-nosection')).toMatchObject({ n: first!.n! + 2, mir: '03' })
      expect((await number('signups', 's-noemail-sofia'))?.n).toBeNull()
      expect((await number('signups', 's-noemail-started'))?.n).toBeNull()
      expect(report).toMatchObject({ numbered: 8, numberedNoSection: 3 })
      expect(describeAdvance(report)).toContain('без секция, по МИР: 3')

      const pushed = calls.filter((call) => call.url.includes('/contacts/') && !call.url.endsWith('/attributes')).map((call) => decodeURIComponent(call.url))
      expect(pushed.some((url) => url.includes('tibroish.invalid'))).toBe(false)
      expect(calls.every((call) => !JSON.stringify(call.body ?? '').includes('tibroish.invalid'))).toBe(true)
      expect(report.brevo.failed).toBe(0)
      expect(mail.deliverMail).not.toHaveBeenCalled()

      // The ZIP, the PDF and „Само новите“ list people by SIGNUP_DESIGNATION_SECTION_SQL: the МИР stands in.
      const listed = await db
        .prepare(`SELECT id, ${SIGNUP_DESIGNATION_SECTION_SQL} AS section FROM signups WHERE ${SIGNUP_DESIGNATION_SECTION_SQL} != '' AND id LIKE 's-noemail%' ORDER BY id`)
        .all<{ id: string; section: string }>()
      expect(listed.results).toEqual([
        { id: 's-noemail', section: '03' },
        { id: 's-noemail-blank', section: '03' },
      ])
      expect(pushed.some((url) => url.includes('real@example.test'))).toBe(false)

      // /admin/palnomoshtni counts them as numbered „без секция“ and never as waiting for Brevo.
      const counts = pipelineCountsFrom(await db.prepare(PIPELINE_COUNTS_SQL).first<Record<string, unknown>>())
      expect(counts.volunteersNumberedNoSection).toBe(3)
      expect(counts.volunteersBrevoPending).toBe(0)
    })

    it('a published one with a section is numbered in the section МИР and still not sent to Brevo', async () => {
      const calls: Call[] = []
      await advancePublished(db, 'all', 'test', { brevo, fetchImpl: fakeBrevo(calls), sectionFields, now: new Date(T0) })
      expect((await number('signups', 's-placeholder'))?.mir).toBe('23')
      const counts = pipelineCountsFrom(await db.prepare(PIPELINE_COUNTS_SQL).first<Record<string, unknown>>())
      expect(counts.volunteersBrevo).toBe(2)
      expect(counts.volunteersBrevoPending).toBe(0)
    })

    it('one ЕГН, one пълномощно: an ЕГН already numbered is skipped', async () => {
      await signup('s-noemail-dup', 'bez-imeil-dup00000@tibroish.invalid', { ...finished, egn: egn('800101123'), mir_code: '03' })
      const report = await advancePublished(db, 'all', 'test', { brevo: null, sectionFields, now: new Date(T0) })
      expect((await number('signups', 's-pub'))?.n).not.toBeNull()
      expect((await number('signups', 's-noemail-dup'))?.n).toBeNull()
      expect(report.skippedDuplicates).toBeGreaterThanOrEqual(1)
    })

    it('numberSectionlessVolunteer numbers just that person, right after staff add or save them', async () => {
      await signup('s-noemail-one', 'bez-imeil-one00000@tibroish.invalid', { ...finished, egn: egn('750505123'), mir_code: '16' })
      await signup('s-noemail-other', 'bez-imeil-oth00000@tibroish.invalid', { ...finished, egn: egn('760606123'), mir_code: '16' })
      expect(await numberSectionlessVolunteer(db, 's-noemail-one', 'staff@example.test', new Date(T0))).toEqual({ number: 501, mir: '16' })
      expect((await number('signups', 's-noemail-other'))?.n).toBeNull()
      // Not for someone who never finished the form, and again is a no-op.
      expect(await numberSectionlessVolunteer(db, 's-draft', 'staff@example.test')).toEqual({ number: null, mir: '' })
      expect(await numberSectionlessVolunteer(db, 's-noemail-one', 'staff@example.test')).toEqual({ number: 501, mir: '16' })
      const audit = await db.prepare(`SELECT COUNT(*) AS n FROM signup_audit WHERE signup_id = 's-noemail-one'`).first<{ n: number }>()
      expect(audit?.n).toBe(1)
    })
  })

  describe('МИР is enough („Само МИР“): every active person with a МИР gets a number', () => {
    it('a finished volunteer with an e-mail and no section is numbered by МИР, once per ЕГН, today', async () => {
      await signup('s-mail-mir', 'mir-only@example.test', { submitted: 1, egn: egn('850505123'), mir_code: '05' })
      await signup('s-mail-unfinished', 'started@example.test', { egn: egn('860606123'), mir_code: '05' })
      await signup('s-mail-sofia', 'sofia@example.test', { submitted: 1, egn: egn('870707123'), mir_code: '', region_code: 'sofia-merged' })
      // Same ЕГН as a numbered „И аз“ in the same МИР: covered, never a second number.
      await partner('pp-held-05', '880808123', {}, { designation_mir: '05', designation_number: 504, designation_issued_at: '21.10.2026' })
      await signup('s-mail-covered', 'covered@example.test', { submitted: 1, egn: egn('880808123'), mir_code: '05' })
      const report = await advancePublished(db, 'all', 'cron', { brevo: null, sectionFields, now: new Date(T0) })
      const row = await db
        .prepare(`SELECT designation_number AS n, designation_mir AS mir, designation_issued_at AS issued, designation_wave_id AS wave FROM signups WHERE id = 's-mail-mir'`)
        .first<{ n: number; mir: string; issued: string; wave: string | null }>()
      // Next after the МИР's numbers in both tables (504 held by the „И аз“ row).
      expect(row).toEqual({ n: 505, mir: '05', issued: '29.10.2026', wave: null })
      expect((await number('signups', 's-mail-unfinished'))?.n).toBeNull()
      expect((await number('signups', 's-mail-sofia'))?.n).toBeNull()
      expect((await number('signups', 's-mail-covered'))?.n).toBeNull()
      expect(report.numberedNoSection).toBe(1)
      expect(mail.deliverMail).not.toHaveBeenCalled()
    })

    it('a „И аз“ person with only a МИР is numbered; withdrawn or no МИР is not; numbers never change', async () => {
      await partner('pp-mir-only', '890909123', {}, { designation_mir: '16' })
      await partner('pp-no-mir', '900101123', {}, {})
      await partner('pp-gone', '910202123', {}, { designation_mir: '16', withdrawn_at: T0 })
      await advancePublished(db, 'all', 'cron', { brevo: null, sectionFields, now: new Date(T0) })
      const first = await number('partner_people', 'pp-mir-only')
      expect(first).toMatchObject({ mir: '16' })
      expect(first?.n).toBeGreaterThan(500)
      expect((await number('partner_people', 'pp-no-mir'))?.n).toBeNull()
      expect((await number('partner_people', 'pp-gone'))?.n).toBeNull()
      await advancePublished(db, 'all', 'cron', { brevo: null, sectionFields, now: new Date('2026-10-30T08:00:00.000Z') })
      expect(await number('partner_people', 'pp-mir-only')).toEqual(first)
    })

    it('numberSectionlessVolunteer numbers a volunteer with an e-mail right after staff save them', async () => {
      await signup('s-mail-one', 'one@example.test', { submitted: 1, egn: egn('920303123'), mir_code: '16' })
      expect(await numberSectionlessVolunteer(db, 's-mail-one', 'staff@example.test', new Date(T0))).toEqual({ number: 501, mir: '16' })
      // A published section is the publish pipeline's job, not this one.
      expect(await numberSectionlessVolunteer(db, 's-pub', 'staff@example.test', new Date(T0))).toEqual({ number: null, mir: '' })
    })
  })
})

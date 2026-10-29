// Waves of signed пълномощни and the per-РИК ZIP layout.
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { collectStream, streamZipWriter } from './designation-zip-stream'
import { PARTNER_PEOPLE_TABLE, PARTNER_WITHDRAWAL_COLUMNS } from './partner-people-sql'
import {
  MISSING_PDFS_FILENAME,
  SIGNED_PEOPLE_SQL,
  peopleInWave,
  rikRowFor,
  signedPdfName,
  signedPersonFromRow,
  signedWaves,
  signedZipBaseName,
  sofiaDateKey,
  unsentSummary,
  UNSENT_WAVES_KEY,
  issueKeyOf,
  rikCorrectionsFilename,
  writeSignedWaveZip,
  WAVE_PEOPLE_SQL,
  type ClosedWaveRow,
  type SignedPerson,
  type SignedRow,
} from './signed-waves'
import { CLOSED_WAVES_SQL, CLOSE_WAVE_SQL, SIGNED_WAVE_COLUMNS, SIGNED_WAVE_SET_SQL, SIGNING_WAVE_SCHEMA } from './signed-waves-sql'

const person = (over: Partial<SignedPerson> = {}): SignedPerson => ({
  id: 's-1',
  firstName: 'Тодор',
  middleName: 'Иванов',
  lastName: 'Пробов',
  egn: '8801021015',
  mir: '02',
  number: 605,
  issuedAt: '19.10.2026',
  issueKey: '2026-10-19',
  waveId: '',
  signed: true,
  firstSignedAt: '2026-10-19T17:58:04.778Z',
  driveFileId: 'drive-1',
  partner: false,
  ...over,
})

describe('signed waves', () => {
  it('keys a wave by the Sofia calendar day, across UTC midnight', () => {
    expect(sofiaDateKey('2026-10-19T17:58:04.778Z')).toBe('2026-10-19')
    expect(sofiaDateKey('2026-10-19T20:59:59.000Z')).toBe('2026-10-19')
    expect(sofiaDateKey('2026-10-19T21:00:00.000Z')).toBe('2026-10-20')
    // Winter time (UTC+2) after 25.10.
    expect(sofiaDateKey('2026-10-26T21:59:00.000Z')).toBe('2026-10-26')
    expect(sofiaDateKey('2026-10-26T22:00:00.000Z')).toBe('2026-10-27')
    expect(sofiaDateKey('nope')).toBe('')
  })

  it('a wave is the PDF date, never the upload day; counts signed people per РИК', () => {
    const people = [
      person({ id: 'a', issuedAt: '19.10.2026', issueKey: '2026-10-19', firstSignedAt: '2026-10-19T17:58:00Z' }),
      // Numbered 19.10, signed file uploaded two days later: still the 19.10 wave.
      person({ id: 'late', mir: '23', issuedAt: '19.10.2026', issueKey: '2026-10-19', firstSignedAt: '2026-10-21T09:00:00Z' }),
      person({ id: 'pp-c', partner: true, mir: '23', issuedAt: '20.10.2026', issueKey: '2026-10-20', firstSignedAt: '2026-10-20T09:00:00Z' }),
      person({ id: 'd', mir: '02', issuedAt: '20.10.2026', issueKey: '2026-10-20', signed: false, firstSignedAt: '' }),
    ]
    const waves = signedWaves(people)
    expect(waves.map(({ key, wave, date, count, total, partners, mirs, closed }) => ({ key, wave, date, count, total, partners, mirs, closed }))).toEqual([
      { key: '2026-10-19', wave: 0, date: '19.10.2026', count: 2, total: 2, partners: 0, mirs: [{ mir: '02', count: 1 }, { mir: '23', count: 1 }], closed: false },
      { key: '2026-10-20', wave: 0, date: '20.10.2026', count: 1, total: 2, partners: 1, mirs: [{ mir: '23', count: 1 }], closed: false },
    ])
    expect(peopleInWave(people, '2026-10-19').map((item) => item.id)).toEqual(['a', 'late'])
    expect(peopleInWave(people, '2026-10-21')).toEqual([])
    // „all“ is everyone signed; the unsigned one is in no ZIP.
    expect(peopleInWave(people, 'all').map((item) => item.id)).toEqual(['a', 'late', 'pp-c'])
  })

  it('closed waves of one date come before its open wave, in closing order', () => {
    const closed = [
      { id: 'w-b', issue_date: '2026-10-29', closed_at: '2026-10-29T15:00:00Z', closed_by: 'admin@example.com' },
      { id: 'w-a', issue_date: '2026-10-29', closed_at: '2026-10-29T09:00:00Z', closed_by: 'admin@example.com' },
      { id: 'w-old', issue_date: '2026-10-21', closed_at: '2026-10-22T09:00:00Z', closed_by: '' },
    ]
    const at29 = { issuedAt: '29.10.2026', issueKey: '2026-10-29' }
    const people = [
      person({ id: 'old', issuedAt: '21.10.2026', issueKey: '2026-10-21', waveId: 'w-old' }),
      person({ id: 'm1', ...at29, waveId: 'w-a' }),
      person({ id: 'm2', ...at29, waveId: 'w-b', signed: false, firstSignedAt: '' }),
      person({ id: 'm3', ...at29 }),
      // A wave id nobody knows (never closed here): the open wave of the PDF date.
      person({ id: 'm4', ...at29, waveId: 'ghost' }),
    ]
    expect(signedWaves(people, closed).map((wave) => [wave.wave, wave.key, wave.date, wave.closed, wave.total])).toEqual([
      [1, 'w-old', '21.10.2026', true, 1],
      [2, 'w-a', '29.10.2026', true, 1],
      [3, 'w-b', '29.10.2026', true, 1],
      [0, '2026-10-29', '29.10.2026', false, 2],
    ])
    expect(peopleInWave(people, 'w-a', closed).map((item) => item.id)).toEqual(['m1'])
    expect(peopleInWave(people, 'w-b', closed)).toEqual([])
    expect(peopleInWave(people, '2026-10-29', closed).map((item) => item.id)).toEqual(['m3', 'm4'])
  })

  it('labels: closed waves are numbered among closed ones, open ones go by date and never shift', () => {
    const closed = [
      { id: 'w-21', issue_date: '2026-10-21', closed_at: '2026-10-21T20:59:00Z', closed_by: 'backfill' },
      { id: 'w-27', issue_date: '2026-10-27', closed_at: '2026-10-27T21:59:00Z', closed_by: 'backfill' },
    ]
    const people = [
      person({ id: 'a', mir: '05', number: 501, issuedAt: '21.10.2026', issueKey: '2026-10-21', waveId: 'w-21' }),
      person({ id: 'b', mir: '05', number: 509, issuedAt: '29.10.2026', issueKey: '2026-10-29' }),
    ]
    const before = signedWaves(people, closed).map((wave) => wave.label)
    expect(before).toEqual(['Вълна 1 · 21.10.2026', 'Вълна 2 · 27.10.2026', '29.10 · отворена'])
    // A late signer reopens 27.10: the labels already shown stay the same.
    const late = person({ id: 'late', mir: '05', number: 508, issuedAt: '27.10.2026', issueKey: '2026-10-27' })
    const after = signedWaves([...people, late], closed)
    expect(after.map((wave) => wave.label)).toEqual(['Вълна 1 · 21.10.2026', 'Вълна 2 · 27.10.2026', '27.10 · отворена', '29.10 · отворена'])
    expect(after.map((wave) => wave.shortLabel)).toEqual(['вълна 1', 'вълна 2', '27.10', '29.10'])
  })

  it('„Всички неизпратени“: every signed person in any open wave, all dates; nobody from a closed wave, nobody unsigned', () => {
    const closed = [{ id: 'w-27', issue_date: '2026-10-27', closed_at: '2026-10-27T21:59:00Z', closed_by: 'backfill' }]
    const people = [
      person({ id: 'sent', mir: '05', number: 507, issuedAt: '27.10.2026', issueKey: '2026-10-27', waveId: 'w-27' }),
      person({ id: 'late', mir: '05', number: 508, issuedAt: '27.10.2026', issueKey: '2026-10-27' }),
      person({ id: 'today', mir: '05', number: 509, issuedAt: '29.10.2026', issueKey: '2026-10-29' }),
      person({ id: 'other', mir: '23', number: 516, issuedAt: '27.10.2026', issueKey: '2026-10-27' }),
      person({ id: 'unsigned', mir: '05', number: 510, issuedAt: '29.10.2026', issueKey: '2026-10-29', signed: false, firstSignedAt: '' }),
      // A wave id nobody knows: open, so unsent.
      person({ id: 'ghost', mir: '23', number: 517, issuedAt: '29.10.2026', issueKey: '2026-10-29', waveId: 'ghost' }),
    ]
    expect(peopleInWave(people, UNSENT_WAVES_KEY, closed).map((item) => item.id).sort()).toEqual(['ghost', 'late', 'other', 'today'])
    const waves = signedWaves(people, closed)
    expect(unsentSummary(waves)).toEqual({ count: 4, mirs: 2, dates: ['27.10', '29.10'] })
    expect(unsentSummary(waves.filter((wave) => wave.closed))).toEqual({ count: 0, mirs: 0, dates: [] })
  })

  it('the unsent ZIP has one folder and one table per РИК, all open dates together, each row with its own date', async () => {
    const closed = [{ id: 'w-27', issue_date: '2026-10-27', closed_at: '2026-10-27T21:59:00Z', closed_by: '' }]
    const all = [
      person({ id: 'sent', mir: '05', number: 507, firstName: 'Изпратен', issuedAt: '27.10.2026', issueKey: '2026-10-27', waveId: 'w-27' }),
      person({ id: 'today', mir: '05', number: 540, firstName: 'Днешен', issuedAt: '29.10.2026', issueKey: '2026-10-29' }),
      person({ id: 'late', mir: '05', number: 508, firstName: 'Закъснял', issuedAt: '27.10.2026', issueKey: '2026-10-27' }),
      person({ id: 'other', mir: '23', number: 516, firstName: 'Друг', issuedAt: '27.10.2026', issueKey: '2026-10-27' }),
    ]
    const people = peopleInWave(all, UNSENT_WAVES_KEY, closed)
    const bytes = await collectStream(
      streamZipWriter((add) =>
        writeSignedWaveZip(add, { people, committeeFullName: 'Комитет', numberPrefix: '', tablesOnly: true, fetchPdf: async () => new Uint8Array() }).then(() => undefined),
      ),
    )
    const files = unzipSync(bytes)
    expect(Object.keys(files).sort()).toEqual(['РИК 05/РИК 05 Представители.xlsx', 'РИК 23/РИК 23 Представители.xlsx'])
    const table = unzipSync(files['РИК 05/РИК 05 Представители.xlsx']!)
    const strings = strFromU8(table['xl/sharedStrings.xml']!)
    expect(strings).toContain('508/27.10.2026')
    expect(strings).toContain('540/29.10.2026')
    expect(strings).not.toContain('Изпратен')
    const sheet = strFromU8(table['xl/worksheets/sheet1.xml']!)
    expect(sheet.indexOf('<v>508</v>')).toBeLessThan(sheet.indexOf('<v>540</v>'))
  })

  it('names the ZIP: closed by number, open by date, unsent and all by the Sofia day', () => {
    const closed = [{ id: 'w-27', issue_date: '2026-10-27', closed_at: '2026-10-27T21:59:00Z', closed_by: '' }]
    const waves = signedWaves(
      [
        person({ id: 'a', issuedAt: '27.10.2026', issueKey: '2026-10-27', waveId: 'w-27' }),
        person({ id: 'b', issuedAt: '27.10.2026', issueKey: '2026-10-27' }),
      ],
      closed,
    )
    const now = new Date('2026-10-29T22:30:00Z') // already 30.10 in Sofia
    expect(signedZipBaseName('w-27', waves, now)).toBe('podpisani-valna-1-2026-10-27')
    expect(signedZipBaseName('2026-10-27', waves, now)).toBe('podpisani-otvorena-2026-10-27')
    expect(signedZipBaseName(UNSENT_WAVES_KEY, waves, now)).toBe('podpisani-neizprateni-2026-10-30')
    expect(signedZipBaseName('all', waves, now)).toBe('podpisani-vsichki-2026-10-30')
  })

  it('reads the PDF date in both stored formats', () => {
    expect(issueKeyOf('23.10.2026')).toBe('2026-10-23')
    expect(issueKeyOf('2026-10-23')).toBe('2026-10-23')
    expect(issueKeyOf('2026-10-21T08:00:00.000Z')).toBe('2026-10-21')
    expect(issueKeyOf('')).toBe('')
  })

  it('builds the table row and the signed PDF name like the documents', () => {
    expect(rikRowFor(person(), '')).toEqual({ number: 605, name: 'Тодор Иванов Пробов', egn: '8801021015', numberWithDate: '605/19.10.2026' })
    expect(rikRowFor(person({ issuedAt: '2026-10-20', middleName: '' }), '')).toMatchObject({ name: 'Тодор Пробов', numberWithDate: '605/20.10.2026' })
    expect(signedPdfName(person())).toBe('02_605_Тодор_Иванов_Пробов_signed.pdf')
  })

  it('drops rows without a number, a two-digit МИР or a signed time', () => {
    const row: SignedRow = {
      id: 'x',
      first_name: ' Ана ',
      middle_name: null,
      last_name: 'Тест',
      egn: null,
      mir: '02',
      designation_number: 7,
      issued_at: '19.10.2026',
      first_signed_at: '2026-10-19T18:00:00Z',
      drive_file_id: null,
      partner: 1,
    }
    expect(signedPersonFromRow(row)).toMatchObject({ firstName: 'Ана', middleName: '', partner: true, driveFileId: '', number: 7 })
    expect(signedPersonFromRow({ ...row, designation_number: null })).toBeNull()
    expect(signedPersonFromRow({ ...row, mir: '' })).toBeNull()
    // Not signed yet: still a wave member (the wave is the PDF date), not in the ZIP.
    expect(signedPersonFromRow({ ...row, first_signed_at: null })).toMatchObject({ signed: false, issueKey: '2026-10-19' })
    expect(signedPersonFromRow({ ...row, issued_at: null })).toBeNull()
  })
})

describe('signed wave ZIP', () => {
  const people = [
    person({ id: 'a', number: 612, firstName: 'Сия', middleName: 'Петрова', lastName: 'Пробова', driveFileId: 'drive-a' }),
    person({ id: 'b', number: 605, driveFileId: 'drive-b' }),
    person({ id: 'pp-c', partner: true, mir: '23', number: 5, firstName: 'Иа', middleName: '', lastName: 'Партньор', driveFileId: 'broken' }),
    person({ id: 'd', mir: '23', number: 9, firstName: 'Без', middleName: '', lastName: 'Файл', driveFileId: '' }),
  ]

  async function build(tablesOnly: boolean) {
    const bytes = await collectStream(
      streamZipWriter((add) =>
        writeSignedWaveZip(add, {
          people,
          committeeFullName: 'Комитет',
          numberPrefix: '',
          tablesOnly,
          fetchPdf: async (fileId) => {
            if (fileId === 'broken') throw new Error('Drive HTTP 404')
            return new TextEncoder().encode(`%PDF-${fileId}`)
          },
        }).then(() => undefined),
      ),
    )
    return unzipSync(bytes)
  }

  it('puts one folder per РИК with its table and signed PDFs; lists PDFs Drive could not give', async () => {
    const files = await build(false)
    expect(Object.keys(files).sort()).toEqual(
      [
        'РИК 02/РИК 02 Представители.xlsx',
        'РИК 02/02_605_Тодор_Иванов_Пробов_signed.pdf',
        'РИК 02/02_612_Сия_Петрова_Пробова_signed.pdf',
        'РИК 23/РИК 23 Представители.xlsx',
        MISSING_PDFS_FILENAME,
      ].sort(),
    )
    expect(strFromU8(files['РИК 02/02_605_Тодор_Иванов_Пробов_signed.pdf']!)).toBe('%PDF-drive-b')
    const missing = strFromU8(files[MISSING_PDFS_FILENAME]!)
    expect(missing).toContain('РИК 23/23_5_Иа_Партньор_signed.pdf')
    expect(missing).toContain('РИК 23/23_9_Без_Файл_signed.pdf')
    expect(missing).not.toMatch(/\d{10}/)
    // The РИК 23 table still lists both people, partner included, by number.
    const table = unzipSync(files['РИК 23/РИК 23 Представители.xlsx']!)
    const strings = strFromU8(table['xl/sharedStrings.xml']!)
    expect(strings).toContain('Иа Партньор')
    expect(strings).toContain('Без Файл')
    expect(strings).toContain('5/19.10.2026')
    const sheet = strFromU8(table['xl/worksheets/sheet1.xml']!)
    expect(sheet.indexOf('<v>5</v>')).toBeLessThan(sheet.indexOf('<v>9</v>'))
  })

  it('tables only: no PDFs and no missing list', async () => {
    const files = await build(true)
    expect(Object.keys(files).sort()).toEqual(['РИК 02/РИК 02 Представители.xlsx', 'РИК 23/РИК 23 Представители.xlsx'])
  })
})

type Statement = { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }
type Db = { exec(sql: string): void; prepare(sql: string): Statement }
async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}

describe('signed people SQL', () => {
  it('reads signups (not withdrawn) and partner people (not withdrawn, no duplicates); the PDF date is the wave, not the upload', async () => {
    const db = await openDb()
    if (!db) return
    db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, payload TEXT, egn TEXT, withdrawn INTEGER DEFAULT 0, published_section TEXT,
      designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, designation_signed_at TEXT, designation_drive_file_id TEXT,
      designation_pdf_url TEXT, updated_at TEXT)`)
    db.exec(PARTNER_PEOPLE_TABLE)
    for (const sql of [...SIGNED_WAVE_COLUMNS, ...SIGNING_WAVE_SCHEMA, ...PARTNER_WITHDRAWAL_COLUMNS]) db.exec(sql)
    const payload = JSON.stringify({ firstName: 'Тодор', middleName: 'Иванов', lastName: 'Пробов' })
    const add = db.prepare(`INSERT INTO signups (id, payload, egn, withdrawn, published_section, designation_mir, designation_number, designation_issued_at, designation_signed_at, designation_drive_file_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, '19.10.2026', ?, 'f')`)
    add.run('s1', payload, 'x1', 0, '020400001', '02', 605, '2026-10-19T17:58:00Z')
    add.run('s2', payload, 'x2', 1, '020400002', '02', 606, '2026-10-19T17:58:00Z')
    add.run('s3', payload, 'x3', 0, '230100001', null, 7, '2026-10-19T19:00:00Z')
    add.run('s4', payload, 'x4', 0, '020400003', '02', 607, null)
    const partner = db.prepare(`INSERT INTO partner_people (id, partner, egn, first_name, last_name, designation_mir, designation_number, designation_issued_at, designation_signed_at, imported_at, updated_at, withdrawn_at)
      VALUES (?, 'i-az', ?, 'Иа', 'Партньор', '23', ?, '20.10.2026', '2026-10-20T08:00:00Z', 'now', 'now', ?)`)
    partner.run('pp-1', 'y', 8, null)
    // Withdrawn „И аз“ пълномощно: not in a wave.
    partner.run('pp-2', 'y2', 9, '2026-10-21T10:00:00Z')
    // Same ЕГН as volunteer s1, who keeps № 605: a duplicate, not in a wave.
    partner.run('pp-3', 'x1', 10, null)

    // A replacement upload today keeps s1 in its first wave.
    db.prepare(`UPDATE signups SET ${SIGNED_WAVE_SET_SQL}, designation_signed_at = ? WHERE id = ?`).run('2026-10-20T09:00:00Z', '2026-10-20T09:00:00Z', 's1')
    // A first upload sets both.
    db.prepare(`UPDATE signups SET ${SIGNED_WAVE_SET_SQL}, designation_signed_at = ? WHERE id = ?`).run('2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z', 's4')

    const people = (db.prepare(SIGNED_PEOPLE_SQL).all() as SignedRow[]).map(signedPersonFromRow).filter((item): item is SignedPerson => item != null)
    expect(people.map((item) => [item.id, item.mir, item.number, sofiaDateKey(item.firstSignedAt), item.partner]).sort()).toEqual(
      [
        ['pp-1', '23', 8, '2026-10-20', true],
        ['s1', '02', 605, '2026-10-19', false],
        ['s3', '23', 7, '2026-10-19', false],
        ['s4', '02', 607, '2026-10-20', false],
      ].sort(),
    )
    // s4 was numbered 19.10 and uploaded 20.10: it stays in the 19.10 wave.
    expect(signedWaves(people).map((wave) => [wave.wave, wave.key, wave.count])).toEqual([
      [0, '2026-10-19', 3],
      [0, '2026-10-20', 1],
    ])
  })

  it('РИК tables: a withdrawn „И аз“ duplicate drops out (03: 504 stays, 515 goes; 17: 501 stays, 506 goes)', async () => {
    const db = await openDb()
    if (!db) return
    db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, payload TEXT, egn TEXT, withdrawn INTEGER DEFAULT 0, published_section TEXT,
      designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, designation_signed_at TEXT, designation_drive_file_id TEXT,
      designation_pdf_url TEXT, updated_at TEXT)`)
    db.exec(PARTNER_PEOPLE_TABLE)
    for (const sql of [...SIGNED_WAVE_COLUMNS, ...SIGNING_WAVE_SCHEMA, ...PARTNER_WITHDRAWAL_COLUMNS]) db.exec(sql)
    const payload = JSON.stringify({ firstName: 'Тест', middleName: 'Тестов', lastName: 'Тестов' })
    const vol = db.prepare(`INSERT INTO signups (id, payload, egn, published_section, designation_mir, designation_number, designation_issued_at, designation_signed_at, designation_drive_file_id)
      VALUES (?, ?, ?, ?, ?, ?, '19.10.2026', '2026-10-19T17:58:00Z', 'f')`)
    vol.run('vol-03', payload, 'E03', '030600386', '03', 504)
    vol.run('vol-17', payload, 'E17', '171300011', '17', 501)
    const partner = db.prepare(`INSERT INTO partner_people (id, partner, egn, first_name, last_name, designation_mir, designation_number, designation_issued_at, designation_signed_at, imported_at, updated_at)
      VALUES (?, 'iaz.bg', ?, 'Тест', 'Тестов', ?, ?, '19.10.2026', '2026-10-21T07:22:00Z', 'now', 'now')`)
    partner.run('pp-03', 'E03', '03', 515)
    partner.run('pp-17', 'E17', '17', 506)
    partner.run('pp-other', 'E99', '03', 508)
    const listed = () =>
      (db.prepare(SIGNED_PEOPLE_SQL).all() as SignedRow[])
        .map(signedPersonFromRow)
        .filter((item): item is SignedPerson => item != null)
        .map((item) => `${item.mir}/${item.number}`)
        .sort()
    // Even before the withdrawal the duplicates are kept out (same ЕГН, the volunteer keeps the number).
    expect(listed()).toEqual(['03/504', '03/508', '17/501'])
    db.exec("UPDATE partner_people SET withdrawn_at = '2026-10-21T16:30:00Z', withdrawn_reason = 'Дубликат' WHERE id IN ('pp-03', 'pp-17')")
    expect(listed()).toEqual(['03/504', '03/508', '17/501'])
    // A withdrawn row without a twin is out too.
    db.exec("UPDATE partner_people SET withdrawn_at = '2026-10-21T16:30:00Z' WHERE id = 'pp-other'")
    expect(listed()).toEqual(['03/504', '17/501'])
  })
})

describe('РИК name corrections in the wave ZIP', () => {
  it('adds a „Поправки“ table for people the РИК has under an old name', async () => {
    const people = [person(), person({ id: 's-2', number: 609, firstName: 'Гергана', middleName: '', lastName: 'Начева-Лазарова', correctionFrom: 'Гергана Начева Начаева-Лазарова' })]
    const bytes = await collectStream(
      streamZipWriter((add) =>
        writeSignedWaveZip(add, { people, committeeFullName: 'Комитет', numberPrefix: '', tablesOnly: true, fetchPdf: async () => new Uint8Array() }).then(() => undefined),
      ),
    )
    const files = unzipSync(bytes)
    const name = `РИК 02/${rikCorrectionsFilename('02')}`
    expect(Object.keys(files)).toContain(name)
    const strings = strFromU8(unzipSync(files[name]!)['xl/sharedStrings.xml']!)
    expect(strings).toContain('Гергана Начева-Лазарова (вместо „Гергана Начева Начаева-Лазарова“)')
    expect(strings).not.toContain('Тодор')
  })
})

describe('closing a wave („Изпратена на РИК“)', () => {
  async function setup() {
    const db = await openDb()
    if (!db) return null
    db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, payload TEXT, egn TEXT, withdrawn INTEGER DEFAULT 0, published_section TEXT,
      designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, designation_signed_at TEXT, designation_drive_file_id TEXT,
      designation_pdf_url TEXT, updated_at TEXT)`)
    db.exec(PARTNER_PEOPLE_TABLE)
    for (const sql of [...SIGNED_WAVE_COLUMNS, ...SIGNING_WAVE_SCHEMA, ...PARTNER_WITHDRAWAL_COLUMNS]) db.exec(sql)
    const vol = db.prepare(`INSERT INTO signups (id, payload, egn, published_section, designation_mir, designation_number, designation_issued_at, designation_signed_at, designation_drive_file_id)
      VALUES (?, ?, ?, ?, '02', ?, ?, ?, 'f')`)
    const add = (id: string, first: string, number: number, issued: string, signed: string | null = null) =>
      vol.run(id, JSON.stringify({ firstName: first, middleName: '', lastName: 'Вълнов' }), `E${id}`, '020400001', number, issued, signed)
    const close = (id: string, date: string, at: string) => {
      const insert = db.prepare(CLOSE_WAVE_SQL[0]!).run(id, date, at, 'admin@example.com') as { changes: number }
      const a = db.prepare(CLOSE_WAVE_SQL[1]!).run(id, date) as { changes: number }
      const b = db.prepare(CLOSE_WAVE_SQL[2]!).run(id, date) as { changes: number }
      return { wave: Number(insert.changes), people: Number(a.changes) + Number(b.changes) }
    }
    const read = () => {
      const people = (db.prepare(WAVE_PEOPLE_SQL).all() as SignedRow[]).map(signedPersonFromRow).filter((item): item is SignedPerson => item != null)
      const closed = db.prepare(CLOSED_WAVES_SQL).all() as ClosedWaveRow[]
      return { people, closed, waves: signedWaves(people, closed) }
    }
    return { db, add, close, read }
  }

  it('closes the signed people of a date; later numbers or signatures that day are a new wave; a second click adds nothing', async () => {
    const t = await setup()
    if (!t) return
    t.add('a', 'Ана', 501, '29.10.2026', '2026-10-29T08:00:00Z')
    t.add('b', 'Боян', 502, '29.10.2026')
    t.add('old', 'Стар', 500, '28.10.2026', '2026-10-28T08:00:00Z')
    // A partner row stored with the ISO form of the same date.
    t.db.prepare(`INSERT INTO partner_people (id, partner, egn, first_name, last_name, designation_mir, designation_number, designation_issued_at, designation_signed_at, imported_at, updated_at)
      VALUES ('pp-1', 'i-az', 'Epp', 'Иа', 'Вълнов', '02', 503, '2026-10-29', '2026-10-29T09:00:00Z', 'now', 'now')`).run()

    // Боян is not signed: he is not sent, so he stays open.
    expect(t.close('w1', '2026-10-29', '2026-10-29T10:00:00Z')).toEqual({ wave: 1, people: 2 })
    expect(t.close('w-again', '2026-10-29', '2026-10-29T10:01:00Z')).toEqual({ wave: 0, people: 0 })

    // Numbered after the click, same date: the next wave.
    t.add('c', 'Цвета', 504, '29.10.2026', '2026-10-29T12:00:00Z')
    let view = t.read()
    expect(view.waves.map((wave) => [wave.wave, wave.key, wave.date, wave.closed, wave.count, wave.total])).toEqual([
      [0, '2026-10-28', '28.10.2026', false, 1, 1],
      [1, 'w1', '29.10.2026', true, 2, 2],
      [0, '2026-10-29', '29.10.2026', false, 1, 2],
    ])
    expect(t.close('w2', '2026-10-29', '2026-10-29T16:00:00Z')).toEqual({ wave: 1, people: 1 })
    view = t.read()
    expect(view.waves.map((wave) => [wave.wave, wave.key, wave.closed, wave.count, wave.total])).toEqual([
      [0, '2026-10-28', false, 1, 1],
      [1, 'w1', true, 2, 2],
      [2, 'w2', true, 1, 1],
      [0, '2026-10-29', false, 0, 1],
    ])
    // Only unsigned people waiting: nothing to close.
    expect(t.close('w3', '2026-10-29', '2026-10-29T17:00:00Z')).toEqual({ wave: 0, people: 0 })
    // The 28.10 wave was never touched.
    expect(view.people.find((item) => item.id === 'old')?.waveId).toBe('')
  })

  it('a late signer shows up in the open wave of their PDF date, after that date was sent; each wave has its own РИК tables', async () => {
    const t = await setup()
    if (!t) return
    t.add('a', 'Ана', 501, '29.10.2026', '2026-10-29T08:00:00Z')
    t.add('b', 'Боян', 502, '29.10.2026')
    t.close('w1', '2026-10-29', '2026-10-29T10:00:00Z')
    t.add('c', 'Цвета', 503, '29.10.2026', '2026-10-29T17:00:00Z')
    t.close('w2', '2026-10-29', '2026-10-29T18:00:00Z')
    // Боян's signed file comes two days later (the upload's SET clause): the open 29.10 wave, ready to send.
    t.db.prepare(`UPDATE signups SET ${SIGNED_WAVE_SET_SQL}, designation_signed_at = ? WHERE id = ?`).run('2026-10-31T09:00:00Z', '2026-10-31T09:00:00Z', 'b')
    const view = t.read()
    expect(view.people.find((item) => item.id === 'b')).toMatchObject({ waveId: '', signed: true })
    expect(view.waves.map((wave) => [wave.key, wave.closed, wave.count, wave.total])).toEqual([
      ['w1', true, 1, 1],
      ['w2', true, 1, 1],
      ['2026-10-29', false, 1, 1],
    ])
    expect(peopleInWave(view.people, 'w1', view.closed).map((item) => item.id)).toEqual(['a'])
    expect(peopleInWave(view.people, '2026-10-29', view.closed).map((item) => item.id)).toEqual(['b'])

    const tableFor = async (wave: string) => {
      const bytes = await collectStream(
        streamZipWriter((add) =>
          writeSignedWaveZip(add, {
            people: peopleInWave(view.people, wave, view.closed),
            committeeFullName: 'Комитет',
            numberPrefix: '',
            tablesOnly: true,
            fetchPdf: null,
          }).then(() => undefined),
        ),
      )
      return strFromU8(unzipSync(unzipSync(bytes)['РИК 02/РИК 02 Представители.xlsx']!)['xl/sharedStrings.xml']!)
    }
    const first = await tableFor('w1')
    expect(first).toContain('Ана Вълнов')
    expect(first).not.toContain('Боян')
    expect(first).not.toContain('Цвета')
    const second = await tableFor('w2')
    expect(second).toContain('503/29.10.2026')
    expect(second).not.toContain('Ана')
    const late = await tableFor('2026-10-29')
    expect(late).toContain('502/29.10.2026')
    expect(late).not.toContain('Ана')
  })
})

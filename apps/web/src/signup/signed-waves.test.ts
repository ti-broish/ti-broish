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
  sofiaDateKey,
  rikCorrectionsFilename,
  writeSignedWaveZip,
  type SignedPerson,
  type SignedRow,
} from './signed-waves'
import { SIGNED_WAVE_COLUMNS, SIGNED_WAVE_SET_SQL } from './signed-waves-sql'

const person = (over: Partial<SignedPerson> = {}): SignedPerson => ({
  id: 's-1',
  firstName: 'Тодор',
  middleName: 'Иванов',
  lastName: 'Пробов',
  egn: '8801021015',
  mir: '02',
  number: 605,
  issuedAt: '19.10.2026',
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

  it('numbers waves by date and counts people per РИК', () => {
    const people = [
      person({ id: 'a', firstSignedAt: '2026-10-19T17:58:00Z' }),
      person({ id: 'b', mir: '23', firstSignedAt: '2026-10-19T19:26:00Z' }),
      person({ id: 'pp-c', partner: true, mir: '23', firstSignedAt: '2026-10-20T09:00:00Z' }),
      person({ id: 'd', mir: '02', firstSignedAt: '2026-10-20T10:00:00Z' }),
    ]
    const waves = signedWaves(people)
    expect(waves).toEqual([
      { key: '2026-10-19', wave: 1, date: '19.10.2026', count: 2, partners: 0, mirs: [{ mir: '02', count: 1 }, { mir: '23', count: 1 }] },
      { key: '2026-10-20', wave: 2, date: '20.10.2026', count: 2, partners: 1, mirs: [{ mir: '02', count: 1 }, { mir: '23', count: 1 }] },
    ])
    expect(peopleInWave(people, '2026-10-19').map((item) => item.id)).toEqual(['a', 'b'])
    expect(peopleInWave(people, 'all')).toHaveLength(4)
    expect(peopleInWave(people, '2026-10-21')).toEqual([])
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
      issued_at: null,
      first_signed_at: '2026-10-19T18:00:00Z',
      drive_file_id: null,
      partner: 1,
    }
    expect(signedPersonFromRow(row)).toMatchObject({ firstName: 'Ана', middleName: '', partner: true, driveFileId: '', number: 7 })
    expect(signedPersonFromRow({ ...row, designation_number: null })).toBeNull()
    expect(signedPersonFromRow({ ...row, mir: '' })).toBeNull()
    expect(signedPersonFromRow({ ...row, first_signed_at: null })).toBeNull()
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
  it('reads signups (not withdrawn) and partner people (not withdrawn, no duplicates), and the first upload fixes the wave', async () => {
    const db = await openDb()
    if (!db) return
    db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, payload TEXT, egn TEXT, withdrawn INTEGER DEFAULT 0, published_section TEXT,
      designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, designation_signed_at TEXT, designation_drive_file_id TEXT,
      designation_pdf_url TEXT, updated_at TEXT)`)
    db.exec(PARTNER_PEOPLE_TABLE)
    for (const sql of [...SIGNED_WAVE_COLUMNS, ...PARTNER_WITHDRAWAL_COLUMNS]) db.exec(sql)
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
    expect(signedWaves(people).map((wave) => [wave.wave, wave.key, wave.count])).toEqual([
      [1, '2026-10-19', 2],
      [2, '2026-10-20', 2],
    ])
  })

  it('РИК tables: a withdrawn „И аз“ duplicate drops out (03: 504 stays, 515 goes; 17: 501 stays, 506 goes)', async () => {
    const db = await openDb()
    if (!db) return
    db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, payload TEXT, egn TEXT, withdrawn INTEGER DEFAULT 0, published_section TEXT,
      designation_mir TEXT, designation_number INTEGER, designation_issued_at TEXT, designation_signed_at TEXT, designation_drive_file_id TEXT,
      designation_pdf_url TEXT, updated_at TEXT)`)
    db.exec(PARTNER_PEOPLE_TABLE)
    for (const sql of [...SIGNED_WAVE_COLUMNS, ...PARTNER_WITHDRAWAL_COLUMNS]) db.exec(sql)
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

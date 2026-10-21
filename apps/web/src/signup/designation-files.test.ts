import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  BULK_MANIFEST_COLUMNS,
  bulkDesignationFilename,
  bulkDesignationSignedFilename,
  bulkManifestRow,
  designationCountsPart,
  designationMissingSteps,
  expandUploadFiles,
  legacyBulkDesignationFilename,
  matchSignedFiles,
  normalizeDesignationFilename,
  originalHasSignedMarker,
  sanitizeFilenameNamePart,
  serializeBulkManifestCsv,
  transliterateBg,
  transliterateLastName,
  zipBatchPlan,
  type DesignationFilePerson,
} from './designation-files'

const PDF = new TextEncoder().encode('%PDF-1.4 fake')
const TXT = new TextEncoder().encode('just notes')

function person(overrides: Partial<DesignationFilePerson> = {}): DesignationFilePerson {
  return {
    id: 'p1',
    number: 501,
    section: '234600101',
    firstName: 'Мария',
    middleName: 'Георгиева',
    lastName: 'Петрова',
    name: 'Мария Георгиева Петрова',
    hasDriveFile: false,
    ...overrides,
  }
}

describe('Bulgarian transliteration and bulk filenames', () => {
  it('follows the official streamlined system, including ия at word end', () => {
    expect(transliterateLastName('Петрова')).toBe('Petrova')
    expect(transliterateLastName('Щонов')).toBe('Shtonov')
    expect(transliterateLastName('Желязков')).toBe('Zhelyazkov')
    expect(transliterateLastName('Цонев')).toBe('Tsonev')
    expect(transliterateLastName('Чолаков')).toBe('Cholakov')
    expect(transliterateLastName('Шопова')).toBe('Shopova')
    expect(transliterateLastName('Христов')).toBe('Hristov')
    expect(transliterateLastName('Йорданов')).toBe('Yordanov')
    expect(transliterateLastName('Кънев')).toBe('Kanev')
    expect(transliterateLastName('Юлиев')).toBe('Yuliev')
    expect(transliterateLastName('Янева')).toBe('Yaneva')
    expect(transliterateLastName('Драгия')).toBe('Dragia')
    expect(transliterateBg('Мария')).toBe('maria')
    expect(transliterateLastName('Мария')).toBe('Maria')
    expect(transliterateBg('Стоянов')).toBe('stoyanov')
    expect(transliterateLastName('Георгиева-Петрова')).toBe('Georgieva-Petrova')
    expect(transliterateLastName('!!!')).toBe('bez-ime')
    expect(transliterateLastName('')).toBe('bez-ime')
  })

  it('builds MIR_number_Cyrillic-name filenames and drops an empty middle name', () => {
    expect(
      bulkDesignationFilename({
        number: 501,
        section: '234600101',
        firstName: 'Иван',
        middleName: 'Петров',
        lastName: 'Иванов',
      }),
    ).toBe('23_501_Иван_Петров_Иванов.pdf')
    expect(
      bulkDesignationSignedFilename({
        number: 501,
        section: '234600101',
        firstName: 'Иван',
        middleName: 'Петров',
        lastName: 'Иванов',
      }),
    ).toBe('23_501_Иван_Петров_Иванов_signed.pdf')
    expect(
      bulkDesignationFilename({
        number: 12,
        section: '32 460 0001',
        firstName: 'Анна',
        middleName: '',
        lastName: 'Стоянова',
      }),
    ).toBe('32_12_Анна_Стоянова.pdf')
    expect(sanitizeFilenameNamePart('Георгиева-Петрова')).toBe('Георгиева_Петрова')
    expect(sanitizeFilenameNamePart('  Мария  ')).toBe('Мария')
    expect(legacyBulkDesignationFilename({ number: 1, section: '234600101', lastName: 'Петрова' })).toBe(
      '0001_234600101_Petrova.pdf',
    )
  })
})

describe('normalize and match signed uploads', () => {
  const petrova = person()
  const ivanov = person({
    id: 'p2',
    number: 502,
    section: '234600102',
    firstName: 'Иван',
    middleName: 'Иванов',
    lastName: 'Иванов',
    name: 'Иван Иванов Иванов',
  })
  const people = [petrova, ivanov]

  it('normalises _signed, _SIGNED, spaces, -signed, (1), (2), .PDF and zip directories', () => {
    expect(normalizeDesignationFilename('23_501_Мария_Георгиева_Петрова_signed.pdf')).toBe('23_501_Мария_Георгиева_Петрова')
    expect(normalizeDesignationFilename('23_501_Мария_Георгиева_Петрова_SIGNED.pdf')).toBe('23_501_Мария_Георгиева_Петрова')
    expect(normalizeDesignationFilename('23_501_Мария_Георгиева_Петрова _signed .pdf')).toBe('23_501_Мария_Георгиева_Петрова')
    expect(normalizeDesignationFilename('23_501_Мария_Георгиева_Петрова-signed.pdf')).toBe('23_501_Мария_Георгиева_Петрова')
    expect(normalizeDesignationFilename('23_501_Мария_Георгиева_Петрова_signed (1).pdf')).toBe('23_501_Мария_Георгиева_Петрова')
    expect(normalizeDesignationFilename('23_501_Мария_Георгиева_Петрова (2).PDF')).toBe('23_501_Мария_Георгиева_Петрова')
    expect(normalizeDesignationFilename('folder/inner/23_501_Мария_Георгиева_Петрова_signed.pdf')).toBe(
      '23_501_Мария_Георгиева_Петрова',
    )
    expect(normalizeDesignationFilename('23_501_Мария_Георгиева_Петрова - Copy.pdf')).toBe('23_501_Мария_Георгиева_Петрова')
    expect(originalHasSignedMarker('23_502_Иван_Иванов_Иванов_SIGNED (1).PDF')).toBe(true)
    expect(originalHasSignedMarker('23_501_Мария_Георгиева_Петрова.pdf')).toBe(false)
    // Legacy ASCII names still normalise.
    expect(normalizeDesignationFilename('0001_234600101_Petrova_signed.pdf')).toBe('0001_234600101_Petrova')
  })

  it('matches the new Cyrillic names, warns when _signed is missing, and still matches', () => {
    const result = matchSignedFiles(
      [
        { name: '23_501_Мария_Георгиева_Петрова_signed.pdf', bytes: PDF },
        { name: '23_502_Иван_Иванов_Иванов.pdf', bytes: PDF },
      ],
      people,
    )
    expect(result.matched).toHaveLength(2)
    expect(result.matched[0]?.personId).toBe('p1')
    expect(result.matched[0]?.missingSigned).toBe(false)
    expect(result.matched[1]?.personId).toBe('p2')
    expect(result.matched[1]?.missingSigned).toBe(true)
    expect(result.unmatched).toEqual([])
  })

  it('still matches the legacy ASCII filenames on re-upload', () => {
    const result = matchSignedFiles(
      [
        { name: '0501_234600101_Petrova_signed.pdf', bytes: PDF },
        { name: '0502_234600102_Ivanov_signed.pdf', bytes: PDF },
      ],
      people,
    )
    expect(result.matched.map((row) => row.personId)).toEqual(['p1', 'p2'])
  })

  it('falls back to МИР+number (and legacy number+section), and rejects a mismatch', () => {
    const ok = matchSignedFiles([{ name: '23_502_Something_signed.pdf', bytes: PDF }], people)
    expect(ok.matched[0]?.personId).toBe('p2')
    const badMir = matchSignedFiles([{ name: '01_502_Иван_Иванов_Иванов_signed.pdf', bytes: PDF }], people)
    expect(badMir.matched).toEqual([])
    expect(badMir.unmatched[0]?.reason).toMatch(/МИР/)
    const badSection = matchSignedFiles([{ name: '0502_000000000_Nobody_signed.pdf', bytes: PDF }], people)
    expect(badSection.matched).toEqual([])
    expect(badSection.unmatched[0]?.reason).toMatch(/секцията/)
  })

  it('marks duplicates so none of those files are uploaded', () => {
    const result = matchSignedFiles(
      [
        { name: '23_501_Мария_Георгиева_Петрова_signed.pdf', bytes: PDF },
        { name: '23_501_Мария_Георгиева_Петрова_SIGNED (1).PDF', bytes: PDF },
        { name: '23_502_Иван_Иванов_Иванов_signed.pdf', bytes: PDF },
      ],
      people,
    )
    expect(result.matched.map((row) => row.personId)).toEqual(['p2'])
    expect(result.duplicates).toHaveLength(1)
    expect(result.duplicates[0]?.personId).toBe('p1')
    expect(result.duplicates[0]?.fileNames).toHaveLength(2)
  })

  it('reports an unknown number and a non-pdf', () => {
    const result = matchSignedFiles(
      [
        { name: '23_9999_Nobody_signed.pdf', bytes: PDF },
        { name: 'notes.txt', bytes: TXT },
        { name: 'empty.pdf', bytes: TXT },
      ],
      people,
    )
    expect(result.unmatched[0]?.reason).toMatch(/няма човек с този номер/)
    expect(result.notPdf).toHaveLength(2)
  })

  it('expands a zip and keeps directory prefixes for matching', () => {
    const zipped = zipSync({
      'batch/23_501_Мария_Георгиева_Петрова_signed.pdf': PDF,
      'batch/notes.txt': TXT,
    })
    const expanded = expandUploadFiles([{ name: 'batch.zip', bytes: zipped }])
    expect(expanded.map((file) => file.name)).toEqual([
      'batch/23_501_Мария_Георгиева_Петрова_signed.pdf',
      'batch/notes.txt',
    ])
    const result = matchSignedFiles(expanded, people)
    expect(result.matched[0]?.personId).toBe('p1')
    expect(result.notPdf[0]?.fileName).toContain('notes.txt')
  })

  it('sets willReplace when the person already has a Drive file', () => {
    const result = matchSignedFiles(
      [{ name: '23_501_Мария_Георгиева_Петрова_signed.pdf', bytes: PDF }],
      [person({ hasDriveFile: true })],
    )
    expect(result.matched[0]?.willReplace).toBe(true)
  })
})

describe('bulk manifest CSV', () => {
  it('writes UTF-8 BOM, the bulk columns, and no ЕГН', () => {
    const csv = serializeBulkManifestCsv([
      bulkManifestRow(person()),
      bulkManifestRow(
        person({
          id: 'p2',
          number: 502,
          firstName: 'Иван',
          middleName: '',
          lastName: 'Иванов',
          name: 'Иван Иванов',
          section: '234600102',
        }),
      ),
    ])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\n')
    expect(lines[0]).toBe(BULK_MANIFEST_COLUMNS.join(','))
    expect(lines[1]).toContain('23_501_Мария_Георгиева_Петрова.pdf')
    expect(lines[1]).toContain('p1')
    expect(csv).not.toMatch(/\d{10}/)
    expect(csv.toLowerCase()).not.toContain('egn')
  })

  it('plans ZIP batches of 100', () => {
    expect(zipBatchPlan(250)).toEqual([
      { offset: 0, limit: 100, from: 1, to: 100 },
      { offset: 100, limit: 100, from: 101, to: 200 },
      { offset: 200, limit: 50, from: 201, to: 250 },
    ])
  })
})

describe('designationMissingSteps', () => {
  const person = (number: number | null, signingGeneratedAt: string | null, signedAt: string | null) => ({ number, signingGeneratedAt, signedAt })

  it('splits people without a signed пълномощно into three steps that add up to the total', () => {
    const people = [
      person(null, null, null),
      person(null, null, null),
      person(1, null, null),
      person(2, '2026-10-21T10:00:00.000Z', null),
      person(3, '2026-10-21T10:00:00.000Z', null),
      person(4, null, null),
      person(5, '2026-10-21T10:00:00.000Z', '2026-10-21T12:00:00.000Z'),
      person(6, null, '2026-10-21T12:00:00.000Z'),
    ]
    const steps = designationMissingSteps(people)
    expect(steps).toEqual({ noNumber: 2, notDownloaded: 2, awaitingSignature: 2 })
    const missing = people.filter((row) => !row.signedAt).length
    expect(steps.noNumber + steps.notDownloaded + steps.awaitingSignature).toBe(missing)
  })

  it('is all zero when everyone is signed or nobody is listed', () => {
    expect(designationMissingSteps([])).toEqual({ noNumber: 0, notDownloaded: 0, awaitingSignature: 0 })
    expect(designationMissingSteps([person(1, '2026-10-21T10:00:00.000Z', '2026-10-21T12:00:00.000Z')])).toEqual({
      noNumber: 0,
      notDownloaded: 0,
      awaitingSignature: 0,
    })
  })
})

describe('designationCountsPart', () => {
  it('counts everyone it is given and the missing steps add up to missing', () => {
    const at = '2026-10-21T10:00:00.000Z'
    const part = designationCountsPart([
      { number: null, generatedAt: null, signingGeneratedAt: null, signedAt: null },
      { number: 1, generatedAt: at, signingGeneratedAt: null, signedAt: null },
      { number: 2, generatedAt: at, signingGeneratedAt: at, signedAt: null },
      { number: 3, generatedAt: at, signingGeneratedAt: at, signedAt: at },
    ])
    expect(part).toEqual({
      published: 4,
      numbered: 3,
      generated: 3,
      signed: 1,
      missing: 3,
      missingSteps: { noNumber: 1, notDownloaded: 1, awaitingSignature: 1 },
    })
    const steps = part.missingSteps!
    expect(steps.noNumber + steps.notDownloaded + steps.awaitingSignature).toBe(part.missing)
    expect(part.signed + part.missing).toBe(part.published)
  })
})

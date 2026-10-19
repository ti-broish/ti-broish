import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  BULK_MANIFEST_COLUMNS,
  bulkDesignationFilename,
  bulkDesignationSignedFilename,
  bulkManifestRow,
  expandUploadFiles,
  matchSignedFiles,
  normalizeDesignationFilename,
  originalHasSignedMarker,
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
    number: 1,
    section: '234600101',
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

  it('builds ASCII filenames from the integer, 9-digit section and last name', () => {
    expect(bulkDesignationFilename({ number: 1, section: '234600101', lastName: 'Петрова' })).toBe(
      '0001_234600101_Petrova.pdf',
    )
    expect(bulkDesignationSignedFilename({ number: 1, section: '234600101', lastName: 'Петрова' })).toBe(
      '0001_234600101_Petrova_signed.pdf',
    )
    expect(bulkDesignationFilename({ number: 12, section: '32 460 0001', lastName: '' })).toBe('0012_324600001_bez-ime.pdf')
  })
})

describe('normalize and match signed uploads', () => {
  const petrova = person()
  const ivanov = person({
    id: 'p2',
    number: 2,
    section: '234600102',
    lastName: 'Иванов',
    name: 'Иван Иванов Иванов',
  })
  const people = [petrova, ivanov]

  it('normalises _signed, _SIGNED, spaces, -signed, (1), (2), .PDF and zip directories', () => {
    expect(normalizeDesignationFilename('0001_234600101_Petrova_signed.pdf')).toBe('0001_234600101_Petrova')
    expect(normalizeDesignationFilename('0001_234600101_Petrova_SIGNED.pdf')).toBe('0001_234600101_Petrova')
    expect(normalizeDesignationFilename('0001_234600101_Petrova _signed .pdf')).toBe('0001_234600101_Petrova')
    expect(normalizeDesignationFilename('0001_234600101_Petrova-signed.pdf')).toBe('0001_234600101_Petrova')
    expect(normalizeDesignationFilename('0001_234600101_Petrova_signed (1).pdf')).toBe('0001_234600101_Petrova')
    expect(normalizeDesignationFilename('0001_234600101_Petrova (2).PDF')).toBe('0001_234600101_Petrova')
    expect(normalizeDesignationFilename('folder/inner/0001_234600101_Petrova_signed.pdf')).toBe('0001_234600101_Petrova')
    expect(normalizeDesignationFilename('0001_234600101_Petrova - Copy.pdf')).toBe('0001_234600101_Petrova')
    expect(originalHasSignedMarker('0002_234600102_Ivanov_SIGNED (1).PDF')).toBe(true)
    expect(originalHasSignedMarker('0001_234600101_Petrova.pdf')).toBe(false)
  })

  it('matches exact names, warns when _signed is missing, and still matches', () => {
    const result = matchSignedFiles(
      [
        { name: '0001_234600101_Petrova_signed.pdf', bytes: PDF },
        { name: '0002_234600102_Ivanov.pdf', bytes: PDF },
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

  it('falls back to the leading number when the section matches, and rejects a section mismatch', () => {
    const ok = matchSignedFiles([{ name: '0002_234600102_Something_signed.pdf', bytes: PDF }], people)
    expect(ok.matched[0]?.personId).toBe('p2')
    const bad = matchSignedFiles([{ name: '0002_000000000_Nobody_signed.pdf', bytes: PDF }], people)
    expect(bad.matched).toEqual([])
    expect(bad.unmatched[0]?.reason).toMatch(/секцията/)
  })

  it('marks duplicates so none of those files are uploaded', () => {
    const result = matchSignedFiles(
      [
        { name: '0001_234600101_Petrova_signed.pdf', bytes: PDF },
        { name: '0001_234600101_Petrova_SIGNED (1).PDF', bytes: PDF },
        { name: '0002_234600102_Ivanov_signed.pdf', bytes: PDF },
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
        { name: '9999_000000000_Nobody_signed.pdf', bytes: PDF },
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
      'batch/0001_234600101_Petrova_signed.pdf': PDF,
      'batch/notes.txt': TXT,
    })
    const expanded = expandUploadFiles([{ name: 'batch.zip', bytes: zipped }])
    expect(expanded.map((file) => file.name)).toEqual(['batch/0001_234600101_Petrova_signed.pdf', 'batch/notes.txt'])
    const result = matchSignedFiles(expanded, people)
    expect(result.matched[0]?.personId).toBe('p1')
    expect(result.notPdf[0]?.fileName).toContain('notes.txt')
  })

  it('sets willReplace when the person already has a Drive file', () => {
    const result = matchSignedFiles(
      [{ name: '0001_234600101_Petrova_signed.pdf', bytes: PDF }],
      [person({ hasDriveFile: true })],
    )
    expect(result.matched[0]?.willReplace).toBe(true)
  })
})

describe('bulk manifest CSV', () => {
  it('writes UTF-8 BOM, the bulk columns, and no ЕГН', () => {
    const csv = serializeBulkManifestCsv([
      bulkManifestRow(person()),
      bulkManifestRow(person({ id: 'p2', number: 2, lastName: 'Иванов', name: 'Иван Иванов', section: '234600102' })),
    ])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\n')
    expect(lines[0]).toBe(BULK_MANIFEST_COLUMNS.join(','))
    expect(lines[1]).toContain('0001_234600101_Petrova.pdf')
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

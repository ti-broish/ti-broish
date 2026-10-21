import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  decodeZipEntryName,
  expandUploadFilesDetailed,
  isJunkUploadPath,
  matchSignedFiles,
  signedUploadBlockReason,
  signedUploadPlan,
  type DesignationFilePerson,
} from './designation-files'

const PDF = new TextEncoder().encode('%PDF-1.4 fake')
const APPLE_DOUBLE = new Uint8Array([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00])

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

/**
 * macOS Finder „Compress“ writes UTF-8 names without the UTF-8 flag (bit 11), in decomposed form
 * (NFD: „й“ = „и“ + U+0306). fflate sets the flag, so clear it to get the same bytes as a Mac ZIP.
 */
function macZip(entries: Record<string, Uint8Array>) {
  const nfd: Record<string, Uint8Array> = {}
  for (const [name, bytes] of Object.entries(entries)) nfd[name.normalize('NFD')] = bytes
  const zip = zipSync(nfd, { level: 6 })
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  for (let i = 0; i + 4 <= zip.length; i += 1) {
    const sig = view.getUint32(i, true)
    if (sig === 0x04034b50) view.setUint16(i + 6, view.getUint16(i + 6, true) & ~0x0800, true)
    if (sig === 0x02014b50) view.setUint16(i + 8, view.getUint16(i + 8, true) & ~0x0800, true)
  }
  return zip
}

const people = [
  person(),
  person({ id: 'p2', number: 502, firstName: 'Йордан', middleName: 'Иванов', lastName: 'Стойков', name: 'Йордан Иванов Стойков' }),
  person({ id: 'p3', number: 501, section: '26', firstName: 'Николай', middleName: '', lastName: 'Петров', name: 'Николай Петров', partner: 'i-az' }),
]

describe('signed ZIP uploads (folders, macOS junk, Mac names)', () => {
  it('reads a Finder ZIP of a folder: PDFs in a subfolder, __MACOSX and ._ copies skipped, names fixed', () => {
    const zip = macZip({
      'Signed-2/': new Uint8Array(),
      'Signed-2/23_501_Мария_Георгиева_Петрова_signed.pdf': PDF,
      'Signed-2/23_502_Йордан_Иванов_Стойков_signed.pdf': PDF,
      'Signed-2/.DS_Store': APPLE_DOUBLE,
      '__MACOSX/._Signed-2': APPLE_DOUBLE,
      '__MACOSX/Signed-2/._23_501_Мария_Георгиева_Петрова_signed.pdf': APPLE_DOUBLE,
      '__MACOSX/Signed-2/._23_502_Йордан_Иванов_Стойков_signed.pdf': APPLE_DOUBLE,
    })
    const expanded = expandUploadFilesDetailed([{ name: 'Signed-2.zip', bytes: zip }])
    expect(expanded.problems).toEqual([])
    expect(expanded.ignored).toBe(4)
    expect(expanded.files.map((file) => file.name)).toEqual([
      'Signed-2/23_501_Мария_Георгиева_Петрова_signed.pdf',
      'Signed-2/23_502_Йордан_Иванов_Стойков_signed.pdf',
    ])
    const result = matchSignedFiles(expanded.files, people, expanded)
    expect(result.matched.map((row) => row.personId)).toEqual(['p1', 'p2'])
    expect(result.notPdf).toEqual([])
    expect(result.ignored).toBe(4)
  })

  it('reads PDFs two folders deep (Signed/signed/…) and a ZIP inside the ZIP', () => {
    const inner = macZip({ 'more/26_501_Николай_Петров_signed.pdf': PDF })
    const zip = macZip({
      'Signed/signed/23_501_Мария_Георгиева_Петрова_signed.pdf': PDF,
      '__MACOSX/Signed/signed/._23_501_Мария_Георгиева_Петрова_signed.pdf': APPLE_DOUBLE,
      'Signed/inner.zip': inner,
    })
    const expanded = expandUploadFilesDetailed([{ name: 'Signed.zip', bytes: zip }])
    const result = matchSignedFiles(expanded.files, people, expanded)
    expect(result.matched.map((row) => row.personId).sort()).toEqual(['p1', 'p3'])
    expect(result.unmatched).toEqual([])
  })

  it('reports a broken ZIP by name instead of calling it „not a PDF“', () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])
    const expanded = expandUploadFilesDetailed([{ name: 'Signed.zip', bytes: broken }])
    const result = matchSignedFiles(expanded.files, people, expanded)
    expect(result.notPdf).toHaveLength(1)
    expect(result.notPdf[0]?.reason).toMatch(/ZIP архивът не се отваря/)
    expect(signedUploadBlockReason({ canExport: true, canUploadDrive: true, busy: false, reading: false, preview: result })).toMatch(
      /1 не са PDF или не се четат/,
    )
  })

  it('restores UTF-8 names that fflate read as Latin-1, and folds NFD to NFC', () => {
    const utf8 = new TextEncoder().encode('Signed/23_502_Йордан.pdf'.normalize('NFD'))
    const latin1 = String.fromCharCode(...utf8)
    expect(decodeZipEntryName(latin1)).toBe('Signed/23_502_Йордан.pdf')
    expect(decodeZipEntryName('plain.pdf')).toBe('plain.pdf')
    // Real Latin-1 that is not valid UTF-8 stays as it came.
    expect(decodeZipEntryName('caf\u00e9.pdf')).toBe('café.pdf')
  })

  it('treats macOS and Windows litter as junk', () => {
    expect(isJunkUploadPath('__MACOSX/Signed/._a.pdf')).toBe(true)
    expect(isJunkUploadPath('Signed/._a.pdf')).toBe(true)
    expect(isJunkUploadPath('Signed/.DS_Store')).toBe(true)
    expect(isJunkUploadPath('Signed/Thumbs.db')).toBe(true)
    expect(isJunkUploadPath('Signed/23_501_a_signed.pdf')).toBe(false)
  })

  it('says why the upload button is disabled', () => {
    const base = { canExport: true, canUploadDrive: true, busy: false, reading: false }
    expect(signedUploadBlockReason({ ...base, preview: null })).toMatch(/Избери PDF-и, ZIP или папка/)
    expect(signedUploadBlockReason({ ...base, reading: true, preview: null })).toBe('Четем файловете…')
    expect(signedUploadBlockReason({ ...base, canUploadDrive: false, preview: null })).toMatch(/Drive не е настроен/)
    const none = matchSignedFiles([{ name: '23_999_Някой_signed.pdf', bytes: PDF }], people)
    expect(signedUploadBlockReason({ ...base, preview: none })).toMatch(/1 без съвпадение/)
    const dup = matchSignedFiles(
      [
        { name: 'a/23_501_Мария_Георгиева_Петрова_signed.pdf', bytes: PDF },
        { name: 'b/23_501_Мария_Георгиева_Петрова_signed.pdf', bytes: PDF },
      ],
      people,
    )
    expect(signedUploadBlockReason({ ...base, preview: dup })).toMatch(/1 с дубликати/)
    const ok = matchSignedFiles([{ name: '23_501_Мария_Георгиева_Петрова_signed.pdf', bytes: PDF }], people)
    expect(signedUploadBlockReason({ ...base, preview: ok })).toBe('')
    const unreadable = matchSignedFiles([], people, { problems: [{ fileName: 'Signed-2', reason: 'не се чете' }] })
    expect(signedUploadBlockReason({ ...base, preview: unreadable })).toMatch(/1 не са PDF или не се четат/)
  })
})

describe('single PDFs and whole-ZIP re-uploads', () => {
  const partner = person({ id: 'pp-1', number: 508, section: '23', partner: 'i-az', firstName: 'Ана', middleName: '', lastName: 'Ив', name: 'Ана Ив' })
  const done = person({ id: 'p-done', number: 501, hasDriveFile: true })

  it('matches one loose PDF for an „И аз“ person, also from a mixed-script folder', () => {
    for (const name of ['23_508_Ана_Ив_signed.pdf', 'Signed_\u0422i_Broish/23_508_Ана_Ив_signed.pdf']) {
      const match = matchSignedFiles(expandUploadFilesDetailed([{ name, bytes: PDF }]).files, [partner, done])
      expect(match.matched.map((row) => row.personId)).toEqual(['pp-1'])
    }
  })

  it('skips people who already have a signed file unless replacing is asked for', () => {
    const match = matchSignedFiles(
      [
        { name: '23_508_Ана_Ив_signed.pdf', bytes: PDF },
        { name: '23_501_Мария_Георгиева_Петрова_signed.pdf', bytes: PDF },
      ],
      [partner, done],
    )
    const plan = signedUploadPlan(match, false)
    expect(plan.toUpload.map((row) => row.personId)).toEqual(['pp-1'])
    expect(plan.already.map((row) => row.personId)).toEqual(['p-done'])
    expect(signedUploadPlan(match, true).toUpload).toHaveLength(2)
  })

  it('explains a disabled button when everything in the ZIP is already uploaded', () => {
    const base = { canExport: true, canUploadDrive: true, busy: false, reading: false }
    const match = matchSignedFiles([{ name: '23_501_Мария_Георгиева_Петрова_signed.pdf', bytes: PDF }], [done])
    expect(signedUploadBlockReason({ ...base, preview: match })).toMatch(/Всички 1 съвпаднали вече имат качен подписан файл/)
    expect(signedUploadBlockReason({ ...base, preview: match, replaceExisting: true })).toBe('')
  })
})

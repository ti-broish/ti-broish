import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DESIGNATION_CONFIG } from './designation-config'
import { dataUrlBytes, loadDesignationFonts, useDesignationFonts } from './designation-fonts'
import { registerWorkerDesignationFonts } from './designation-fonts-worker'
import { renderDesignationPdf } from './designation-pdf'

afterEach(() => useDesignationFonts(null))

describe('Worker designation fonts', () => {
  it('decodes a base64 data URL', () => {
    expect([...dataUrlBytes('data:font/ttf;base64,AAEC')]).toEqual([0, 1, 2])
  })

  it('renders from the inline fonts, as the Worker does, without the file system', async () => {
    const files = await loadDesignationFonts()
    registerWorkerDesignationFonts()
    const inline = await loadDesignationFonts()
    expect(inline.regular).toEqual(files.regular)
    expect(inline.bold).toEqual(files.bold)
    const bytes = await renderDesignationPdf(
      {
        number: 1,
        issuedOn: '18.10.2026',
        grantor: { name: '', egn: '', capacity: 'пълномощник', authorisation: '' },
        person: { firstName: 'Иван', middleName: 'Петров', lastName: 'Иванов', egn: '0000000000', sectionCode: '234600001', sectionPlace: '' },
      },
      DEFAULT_DESIGNATION_CONFIG,
    )
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  }, 30_000)
})

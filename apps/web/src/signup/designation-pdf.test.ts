import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGNATION_CONFIG, TODO_GRANTOR_AUTHORISATION, TODO_GRANTOR_EGN, TODO_GRANTOR_NAME } from './designation-config'
import { renderDesignationPdf } from './designation-pdf'
import { buildDesignationBlocks, designationPlainText } from './designation-text'

describe('designation PDF', () => {
  it('renders one A4 page whose title has no personal data, matching the built text', async () => {
    const input = {
      number: 1,
      issuedOn: '18.10.2026',
      grantor: { name: '', egn: '', capacity: 'пълномощник' as const, authorisation: '' },
      person: {
        firstName: 'Иван',
        middleName: 'Петров',
        lastName: 'Иванов',
        egn: '0000000000',
        sectionCode: '234600001',
        sectionPlace: 'гр. София, район Младост',
      },
    }
    const bytes = await renderDesignationPdf(input, DEFAULT_DESIGNATION_CONFIG)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const page = doc.getPage(0)
    const { width, height } = page.getSize()
    expect(width).toBeCloseTo(595.28, 1)
    expect(height).toBeCloseTo(841.89, 1)
    expect(doc.getTitle()).toBe('Пълномощно № 1')
    expect(doc.getTitle()).not.toContain('0000000000')
    expect(doc.getSubject() ?? '').toBe('')
    const text = designationPlainText(buildDesignationBlocks(input, DEFAULT_DESIGNATION_CONFIG))
    expect(text).toContain('Иван Петров Иванов')
    expect(text).toContain('П Ъ Л Н О М О Щ Н О')
    expect(text).toContain('Да бъде ПРЕДСТАВИТЕЛ')
  })

  it('renders TODO placeholders with an empty grantor, empty authorisation and missing section place', async () => {
    const input = {
      number: 1,
      issuedOn: '18.10.2026',
      grantor: { name: '', egn: '', capacity: 'пълномощник' as const, authorisation: '' },
      person: {
        firstName: 'Иван',
        middleName: 'Петров',
        lastName: 'Иванов',
        egn: '0000000000',
        sectionCode: '234600001',
        sectionPlace: '',
      },
    }
    const bytes = await renderDesignationPdf(input, DEFAULT_DESIGNATION_CONFIG)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const text = designationPlainText(buildDesignationBlocks(input, DEFAULT_DESIGNATION_CONFIG))
    expect(text).toContain(TODO_GRANTOR_NAME)
    expect(text).toContain(TODO_GRANTOR_EGN)
    expect(text).toContain(TODO_GRANTOR_AUTHORISATION)
    expect(text).toContain('[TODO: номер]')
    expect(text).toContain('[TODO: дата]')
    expect(text).toContain('За информация: назначена секция № 234600001.')
    expect(text).not.toMatch(/секция № 234600001,/)
  })
})

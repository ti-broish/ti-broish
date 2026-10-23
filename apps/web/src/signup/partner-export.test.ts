import { describe, expect, it } from 'vitest'
import { IAZ_EXPORT_HEADERS, PARTNER_EXPORT_SQL, partnerExportCode, partnerExportCsv, partnerExportRecord, type PartnerExportRow } from './partner-export'

const base: PartnerExportRow = {
  id: 'pp-1',
  email: ' Velicka@Example.com ',
  phone: '0878 648 870',
  first_name: 'Величка',
  middle_name: 'Василева',
  last_name: 'Георгиева',
  region_name: 'Благоевград',
  municipality_name: 'Благоевград',
  place_note: '',
  designation_mir: '01',
  designation_number: 511,
  designation_signed_at: '2026-10-21T08:58:17.440Z',
  designation_pdf_url: 'https://drive.google.com/file/d/abc/view?usp=drivesdk',
  designation_issued_at: '19.10.2026',
  section_draft: '011300012',
  section_published: '011300012',
  section_published_at: '2026-10-21T21:14:00.524Z',
  submitted_at: '2026-10-19T06:03:00.000Z',
}
const places = { '011300012': { town: 'с. Крушево', address: 'КМЕТСТВО' }, '320021010': { town: 'Виена, Австрия', address: 'Pasteurgasse 1, 1090 Wien' } }
const mirNames = { '01': 'Благоевград', '32': 'Извън страната' }
const col = (record: string[], name: (typeof IAZ_EXPORT_HEADERS)[number]) => record[IAZ_EXPORT_HEADERS.indexOf(name)]

describe('„Експорт И аз“ CSV', () => {
  it('has the agreed 23 columns, in order, and never an ЕГН', () => {
    expect(IAZ_EXPORT_HEADERS.join(',')).toBe(
      'EMAIL,FIRSTNAME,MIDDLENAME,LASTNAME,SMS,MIR,MIR_NAME,SIGNUP_REGION,OBSHTINA,PLACE_NOTE,DESIGNATION_NUMBER,DESIGNATION_SIGNED,DOCUMENT_URL,SECTION_STATUS,SECTION_CODE,SECTION_SHORT,SECTION_TOWN,SECTION_ADDRESS,SECTION_PUBLISHED_AT,DESIGNATION_ISSUED_AT,DESIGNATION_SIGNED_AT,SUBMITTED_AT,PARTNER_ID',
    )
    expect(PARTNER_EXPORT_SQL).not.toMatch(/egn/i)
    expect(PARTNER_EXPORT_SQL).toContain('withdrawn_at IS NULL')
  })

  it('a published, signed person', () => {
    const record = partnerExportRecord(base, places, mirNames)
    expect(record).toEqual([
      'velicka@example.com', 'Величка', 'Василева', 'Георгиева', '+359878648870', '01', 'Благоевград', 'Благоевград', 'Благоевград', '',
      '01/511', 'yes', 'https://drive.google.com/file/d/abc/view?usp=drivesdk', 'published', '011300012', 'Секция 012', 'с. Крушево', 'КМЕТСТВО',
      '2026-10-21T21:14:00.524Z', '19.10.2026', '2026-10-21T08:58:17.440Z', '2026-10-19T06:03:00.000Z', 'pp-1',
    ])
  })

  it('a draft keeps SECTION_CODE empty but has its place; no section means none; unsigned has no link', () => {
    const draft = partnerExportRecord({ ...base, section_published: '', section_published_at: '', designation_signed_at: '' }, places, mirNames)
    expect(col(draft, 'SECTION_STATUS')).toBe('draft')
    expect(col(draft, 'SECTION_CODE')).toBe('')
    expect(col(draft, 'SECTION_SHORT')).toBe('Секция 012')
    expect(col(draft, 'SECTION_TOWN')).toBe('с. Крушево')
    expect(col(draft, 'DESIGNATION_SIGNED')).toBe('no')
    expect(col(draft, 'DOCUMENT_URL')).toBe('')
    const none = partnerExportRecord({ ...base, section_published: '', section_draft: '', email: '', phone: '', designation_number: null }, places, mirNames)
    expect(col(none, 'SECTION_STATUS')).toBe('none')
    expect(col(none, 'SECTION_SHORT')).toBe('')
    expect(col(none, 'EMAIL')).toBe('')
    expect(col(none, 'SMS')).toBe('')
    expect(col(none, 'DESIGNATION_NUMBER')).toBe('')
  })

  it('abroad: МИР 32 with the abroad place; the МИР falls back to the section', () => {
    const abroad = partnerExportRecord({ ...base, designation_mir: '', section_draft: '320021010', section_published: '320021010' }, places, mirNames)
    expect(col(abroad, 'MIR')).toBe('32')
    expect(col(abroad, 'MIR_NAME')).toBe('Извън страната')
    expect(col(abroad, 'SECTION_TOWN')).toBe('Виена, Австрия')
    expect(partnerExportCode({ section_published: '', section_draft: '32 002 10 10' })).toBe('320021010')
  })

  it('UTF-8 BOM, comma separated, quoted where needed', () => {
    const csv = partnerExportCsv([base, { ...base, id: 'pp-2', place_note: 'и: Банско, Симитли' }], places, mirNames)
    expect(csv.startsWith('\uFEFFEMAIL,FIRSTNAME,')).toBe(true)
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('"и: Банско, Симитли"')
  })
})

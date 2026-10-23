// „Експорт И аз“: every active „И аз“ person as one CSV row, the same columns as the Brevo file
// sent on 23.10.2026. Never the ЕГН. Built live from D1 and the section address sources.
import { normalizeSection, toCsv } from './admin-csv'
import { normalizeBrevoSms } from './brevo-contact'

export const IAZ_EXPORT_HEADERS = [
  'EMAIL',
  'FIRSTNAME',
  'MIDDLENAME',
  'LASTNAME',
  'SMS',
  'MIR',
  'MIR_NAME',
  'SIGNUP_REGION',
  'OBSHTINA',
  'PLACE_NOTE',
  'DESIGNATION_NUMBER',
  'DESIGNATION_SIGNED',
  'DOCUMENT_URL',
  'SECTION_STATUS',
  'SECTION_CODE',
  'SECTION_SHORT',
  'SECTION_TOWN',
  'SECTION_ADDRESS',
  'SECTION_PUBLISHED_AT',
  'DESIGNATION_ISSUED_AT',
  'DESIGNATION_SIGNED_AT',
  'SUBMITTED_AT',
  'PARTNER_ID',
] as const

/** Active (not withdrawn) „И аз“ people. No ЕГН column, on purpose. */
export const PARTNER_EXPORT_SQL = `SELECT p.id, COALESCE(p.email, '') AS email, COALESCE(p.phone, '') AS phone,
  COALESCE(p.first_name, '') AS first_name, COALESCE(p.middle_name, '') AS middle_name, COALESCE(p.last_name, '') AS last_name,
  COALESCE(p.region_name, '') AS region_name, COALESCE(p.municipality_name, '') AS municipality_name, COALESCE(p.place_note, '') AS place_note,
  COALESCE(p.designation_mir, '') AS designation_mir, p.designation_number,
  COALESCE(p.designation_signed_at, '') AS designation_signed_at, COALESCE(p.designation_pdf_url, '') AS designation_pdf_url,
  COALESCE(p.designation_issued_at, '') AS designation_issued_at,
  COALESCE(p.section_draft, '') AS section_draft, COALESCE(p.section_published, '') AS section_published,
  COALESCE(p.section_published_at, '') AS section_published_at, COALESCE(p.submitted_at, '') AS submitted_at
FROM partner_people p WHERE p.withdrawn_at IS NULL
ORDER BY COALESCE(p.designation_mir, ''), p.designation_number, p.id`

export interface PartnerExportRow {
  id: string
  email: string
  phone: string
  first_name: string
  middle_name: string
  last_name: string
  region_name: string
  municipality_name: string
  place_note: string
  designation_mir: string
  designation_number: number | null
  designation_signed_at: string
  designation_pdf_url: string
  designation_issued_at: string
  section_draft: string
  section_published: string
  section_published_at: string
  submitted_at: string
}

export interface ExportPlace {
  town: string
  address: string
}

const text = (value: unknown) => String(value ?? '').trim()

/** The published section, else the draft: the code whose place goes in the row. */
export function partnerExportCode(row: Pick<PartnerExportRow, 'section_published' | 'section_draft'>) {
  const published = normalizeSection(text(row.section_published))
  if (/^\d{9}$/.test(published)) return published
  const draft = normalizeSection(text(row.section_draft))
  return /^\d{9}$/.test(draft) ? draft : ''
}

export function partnerExportRecord(row: PartnerExportRow, places: Record<string, ExportPlace>, mirNames: Record<string, string>) {
  const published = normalizeSection(text(row.section_published))
  const isPublished = /^\d{9}$/.test(published)
  const code = partnerExportCode(row)
  const status = isPublished ? 'published' : code ? 'draft' : 'none'
  const mir = (text(row.designation_mir) || code.slice(0, 2)).padStart(2, '0').replace(/^00$/, '')
  const signed = Boolean(text(row.designation_signed_at) && text(row.designation_pdf_url))
  const place = places[code] ?? { town: '', address: '' }
  const number = row.designation_number === null || row.designation_number === undefined || text(row.designation_number) === '' ? '' : text(row.designation_number)
  return [
    text(row.email).toLowerCase(),
    text(row.first_name),
    text(row.middle_name),
    text(row.last_name),
    normalizeBrevoSms(text(row.phone)),
    mir,
    mirNames[mir] ?? '',
    text(row.region_name),
    text(row.municipality_name),
    text(row.place_note),
    number ? `${mir}/${number}` : '',
    signed ? 'yes' : 'no',
    signed ? text(row.designation_pdf_url) : '',
    status,
    isPublished ? published : '',
    code ? `Секция ${code.slice(-3)}` : '',
    text(place.town),
    text(place.address),
    text(row.section_published_at),
    text(row.designation_issued_at),
    text(row.designation_signed_at),
    text(row.submitted_at),
    text(row.id),
  ]
}

/** UTF-8 CSV with a BOM (toCsv), comma separated, one row per active „И аз“ person. */
export function partnerExportCsv(rows: PartnerExportRow[], places: Record<string, ExportPlace>, mirNames: Record<string, string>) {
  return toCsv([...IAZ_EXPORT_HEADERS], rows.map((row) => partnerExportRecord(row, places, mirNames)))
}

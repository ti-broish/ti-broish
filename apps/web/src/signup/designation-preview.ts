import {
  configFromEnv,
  formatBgDate,
  grantorFromEnv,
  todayInSofia,
} from './designation-config'
import { bulkDesignationFilename } from './designation-files'
import { renderDesignationPdf } from './designation-pdf'
import { type DesignationPersonInput, type DesignationRenderInput } from './designation-text'

export type StaffDenialState = 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'

export function personIdOk(id: string) {
  return /^[\w-]{1,80}$/.test(id)
}

export function httpStatusForStaffDenial(state: StaffDenialState) {
  if (state === 'nodb') return 503
  if (state === 'forbidden') return 403
  return 401
}

export function namesFromPayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as { firstName?: unknown; middleName?: unknown; lastName?: unknown }
    return {
      firstName: String(parsed.firstName ?? '').trim(),
      middleName: String(parsed.middleName ?? '').trim(),
      lastName: String(parsed.lastName ?? '').trim(),
    }
  } catch {
    return { firstName: '', middleName: '', lastName: '' }
  }
}

export function previewPersonInput(row: {
  payload: string
  egn: string | null
  published_section: string | null
  section_place: string | null
}): DesignationPersonInput {
  const names = namesFromPayload(row.payload)
  return {
    firstName: names.firstName,
    middleName: names.middleName,
    lastName: names.lastName,
    egn: (row.egn ?? '').trim(),
    sectionCode: (row.published_section ?? '').trim(),
    sectionPlace: (row.section_place ?? '').trim(),
  }
}

export function previewNumber(stored: string | number | null | undefined) {
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored
  const raw = String(stored ?? '').trim()
  return raw || null
}

export async function previewDesignationPdf(input: {
  person: DesignationPersonInput
  number: string | number | null
  issuedOn: string
  env: Record<string, string | undefined>
}): Promise<{ bytes: Uint8Array; filename: string }> {
  const config = configFromEnv(input.env)
  const grantor = grantorFromEnv(input.env)
  const renderInput: DesignationRenderInput = {
    number: input.number,
    issuedOn: formatBgDate(input.issuedOn || todayInSofia()),
    grantor,
    person: input.person,
  }
  const bytes = await renderDesignationPdf(renderInput, config)
  const number =
    typeof input.number === 'number' && Number.isFinite(input.number) && input.number > 0
      ? Math.floor(input.number)
      : Number(String(input.number ?? '').replace(/\D/g, '')) || 0
  return {
    bytes,
    filename: bulkDesignationFilename({
      number,
      section: input.person.sectionCode,
      firstName: input.person.firstName,
      middleName: input.person.middleName,
      lastName: input.person.lastName,
    }),
  }
}

export function contentDisposition(filename: string) {
  const fallback = 'palnomoshtno.pdf'
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

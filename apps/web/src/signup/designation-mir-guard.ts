/**
 * A пълномощно is valid only in its МИР. A numbered person (volunteer or „И аз“) whose draft or
 * published section is in another МИР (the first 2 digits of the section) gets a warning badge on
 * every admin row, and publishing that section is refused on the server.
 */
export const DESIGNATION_MIR_MISMATCH = 'Секция извън МИР на пълномощното'

/** The МИР of a section code (9 digits, or 8 with the leading 0 dropped), or ''. */
export function sectionMirOf(section: string | null | undefined) {
  const digits = String(section ?? '').replace(/\D/g, '')
  if (digits.length === 9) return digits.slice(0, 2)
  if (digits.length === 8) return `0${digits.slice(0, 1)}`
  return ''
}

function padMir(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim()
  return /^\d{1,2}$/.test(trimmed) ? trimmed.padStart(2, '0') : ''
}

export interface DesignationMirMismatch {
  section: string
  sectionMir: string
  designationMir: string
}

/** Only a numbered пълномощно binds the МИР; no number, no section or no МИР: no mismatch. */
export function designationMirMismatch(input: {
  designationMir: string | null | undefined
  designationNumber: number | string | null | undefined
  section: string | null | undefined
}): DesignationMirMismatch | null {
  if (input.designationNumber === null || input.designationNumber === undefined || String(input.designationNumber).trim() === '') return null
  const designationMir = padMir(input.designationMir)
  const sectionMir = sectionMirOf(input.section)
  if (!designationMir || !sectionMir || sectionMir === designationMir) return null
  return { section: String(input.section ?? '').replace(/\D/g, ''), sectionMir, designationMir }
}

export function designationMirMessage(mismatch: DesignationMirMismatch) {
  return `${DESIGNATION_MIR_MISMATCH}: секцията е в МИР ${mismatch.sectionMir}, пълномощното е за МИР ${mismatch.designationMir}. Не може да се публикува.`
}

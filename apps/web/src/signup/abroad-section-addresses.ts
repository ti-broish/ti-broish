import { MFA_ABROAD_SECTIONS } from './abroad-section-addresses.data'

/** One abroad section from the MFA table (section name, country and address per the formation orders). */
export type MfaAbroadSection = { country: string; place: string; address: string }

/** MFA row for a 9-digit abroad section code, if the table has it. */
export function mfaAbroadSection(code: string): MfaAbroadSection | undefined {
  const digits = String(code ?? '').replace(/\D/g, '')
  if (!/^32\d{7}$/.test(digits)) return undefined
  return MFA_ABROAD_SECTIONS[digits]
}

/** Street address of an abroad section from the MFA table; empty when unknown (never invented). */
export function abroadSectionAddress(code: string) {
  return mfaAbroadSection(code)?.address.trim() ?? ''
}

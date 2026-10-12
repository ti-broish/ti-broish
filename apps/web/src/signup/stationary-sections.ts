import { STATIONARY_SECTION_LIST } from './stationary-section-ids'

const STATIONARY = new Set(STATIONARY_SECTION_LIST.split('\n'))

/**
 * A section in Bulgaria with no row in the CIK preliminary voter list.
 * The public section list still has it: a mobile commission, a hospital,
 * a prison, a ship, or another place without its own voter roll.
 * Abroad (МИР 32) is not in that list and is left unchanged.
 */
export function isSpecialBulgariaSection(id: string) {
  const digits = id.replace(/\D/g, '')
  if (digits.length !== 9 || digits.startsWith('32')) return false
  return !STATIONARY.has(digits)
}

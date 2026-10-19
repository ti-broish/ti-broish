import type { SignupD1 } from './db-core'

/** Abroad sections (MIR 32) have no street address in the API; the place comes from the abroad sections list. */
export function isAbroadSection(code: string) {
  return /^32\d{7}$/.test(code)
}

export type AbroadPlace = { country: string; city: string; placeLabel: string }

/**
 * LOCATION / SECTION_PLACE for an abroad section: the section's place label (or city) and the country,
 * e.g. „Лондон (Фелтъм), Обединено кралство …“. Falls back to the town and country the person gave.
 */
export function abroadLocation(place: AbroadPlace | undefined, fallback: { townName?: string; countryName?: string } = {}) {
  const label = (place?.placeLabel || place?.city || fallback.townName || '').trim()
  const country = (place?.country || fallback.countryName || '').trim()
  if (!label) return country
  if (!country || label.includes(country)) return label
  return `${label}, ${country}`
}

/** Country, city and label per abroad section code from abroad_priority_sections (the Секции_ППДБ import). */
export async function loadAbroadPlaces(db: SignupD1, codes: string[]) {
  const unique = [...new Set(codes.filter(isAbroadSection))]
  const out = new Map<string, AbroadPlace>()
  for (let index = 0; index < unique.length; index += 90) {
    const chunk = unique.slice(index, index + 90)
    try {
      const found = await db
        .prepare(
          `SELECT section_code, country, city, place_label FROM abroad_priority_sections WHERE section_code IN (${chunk.map(() => '?').join(', ')})`,
        )
        .bind(...chunk)
        .all<{ section_code: string; country: string | null; city: string | null; place_label: string | null }>()
      for (const row of found.results ?? []) {
        out.set(String(row.section_code), {
          country: String(row.country ?? ''),
          city: String(row.city ?? ''),
          placeLabel: String(row.place_label ?? ''),
        })
      }
    } catch {
      // No abroad list yet: the person's own town and country still give a place.
    }
  }
  return out
}

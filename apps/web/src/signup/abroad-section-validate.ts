import { normalizeSection } from './admin-csv'
import { isAbroadSectionCode } from './abroad-coverage'
import type { SignupD1 } from './db-core'

const API = 'https://api.tibroish.bg'
const HEADERS = { Accept: 'application/json', 'Accept-Language': 'bg-BG' }

/** Returns which of the given section codes exist in priority table and/or api.tibroish.bg. */
export async function validateSectionCodesExist(
  db: SignupD1,
  codes: readonly string[],
): Promise<{ valid: Set<string>; unknown: string[] }> {
  const unique = [...new Set(codes.map((code) => normalizeSection(code)).filter((code) => /^\d{9}$/.test(code)))]
  const valid = new Set<string>()
  if (unique.length === 0) return { valid, unknown: [] }

  const known = await db
    .prepare(
      `SELECT section_code FROM abroad_priority_sections WHERE section_code IN (${unique.map(() => '?').join(',')})`,
    )
    .bind(...unique)
    .all<{ section_code: string }>()
  for (const row of known.results ?? []) valid.add(normalizeSection(row.section_code))

  const missing = unique.filter((code) => !valid.has(code))
  const abroadMissing = missing.filter(isAbroadSectionCode)
  if (abroadMissing.length > 0) {
    const found = await lookupAbroadSections(abroadMissing)
    for (const code of found) valid.add(code)
  }

  // Domestic 9-digit codes without priority/API proof stay accepted by format
  // (same as typing a draft in admin). Abroad codes must be proven.
  for (const code of missing) {
    if (!isAbroadSectionCode(code)) valid.add(code)
  }

  const unknown = unique.filter((code) => !valid.has(code))
  return { valid, unknown }
}

async function lookupAbroadSections(codes: string[]) {
  const byCountry = new Map<string, string[]>()
  for (const code of codes) {
    const country = code.slice(2, 5)
    const list = byCountry.get(country) ?? []
    list.push(code)
    byCountry.set(country, list)
  }
  const found = new Set<string>()
  for (const [country, wanted] of byCountry) {
    const towns = await getJson<Array<{ id: number }>>(`towns?country=${encodeURIComponent(country)}`)
    if (!towns?.length) continue
    const want = new Set(wanted)
    for (const town of towns) {
      const sections = await getJson<Array<{ id: string | number }>>(`sections?town=${town.id}`)
      for (const section of sections ?? []) {
        const id = normalizeSection(String(section.id))
        if (want.has(id)) found.add(id)
      }
      if ([...want].every((code) => found.has(code))) break
    }
  }
  return found
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(12_000) })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

/** Cheap BG→Latin map for city/country fold-matching (not the official legal transliteration). */
const CYRILLIC_MULTI: Array<[RegExp, string]> = [
  [/щ/g, 'sht'],
  [/ю/g, 'yu'],
  [/я/g, 'ya'],
  [/ж/g, 'zh'],
  [/ц/g, 'ts'],
  [/ч/g, 'ch'],
  [/ш/g, 'sh'],
]

const CYRILLIC_SINGLE: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ъ: 'a',
  ь: 'y',
  ѝ: 'i',
  ы: 'y',
  э: 'e',
}

/** Latin spellings that differ from BG transliteration (Vienna→viena). */
const LATIN_SPELLING: Record<string, string> = {
  vienna: 'viena',
  istanbul: 'istanbul',
  london: 'london',
}

/**
 * CSV / common names → API `countries` names.
 * РЮА → Република Южна Африка (API); left undocumented forms fall through to fold-match.
 */
export const COUNTRY_ALIASES: Record<string, string> = {
  Германия: 'Германия ФР',
  РЮА: 'Република Южна Африка',
  'Кралство Саудитска Арабия': 'Саудитска Арабия',
  'Хашемитско кралство Йордания': 'Йордания',
}

const NAME_PREFIXES = [/^\s*гр\.?\s+/i, /^\s*с\.?\s+/i, /^\s*остров\s+/i, /^\s*о-в\.?\s+/i]

export function foldName(value: string): string {
  let text = value.trim().toLocaleLowerCase('bg')
  if (!text) return ''
  text = text.normalize('NFD').replace(/[\u0300-\u036f]+/g, '')
  for (const prefix of NAME_PREFIXES) text = text.replace(prefix, '')
  for (const [pattern, latin] of CYRILLIC_MULTI) text = text.replace(pattern, latin)
  let out = ''
  for (const char of text) {
    out += CYRILLIC_SINGLE[char] ?? char
  }
  out = out.replace(/[^a-z0-9\s]+/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  return LATIN_SPELLING[out] ?? out
}

export function namesMatch(a: string, b: string): boolean {
  const left = foldName(a)
  const right = foldName(b)
  if (!left || !right) return false
  if (left === right) return true
  // Vienna/Виена also match when doubles collapse (vienna → viena).
  if (collapseDoubles(left) === collapseDoubles(right)) return true
  if (left.length >= 3 && right.includes(left)) return true
  if (right.length >= 3 && left.includes(right)) return true
  return false
}

function collapseDoubles(value: string) {
  return value.replace(/([a-z])\1+/g, '$1')
}

export function resolveCountryName(raw: string, apiNames: readonly string[]): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const exact = apiNames.find((name) => name === trimmed)
  if (exact) return exact

  const aliased = COUNTRY_ALIASES[trimmed]
  if (aliased) {
    const hit = apiNames.find((name) => name === aliased || namesMatch(name, aliased))
    if (hit) return hit
  }

  if (!foldName(trimmed)) return null
  return apiNames.find((name) => namesMatch(name, trimmed)) ?? null
}

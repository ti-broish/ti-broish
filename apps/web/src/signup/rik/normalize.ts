/**
 * Shared normalizers for РИК registers. Every РИК runs the same CIK site, but each
 * commission types names and пълномощно numbers its own way (surveyed on all 31 РИК
 * and CIK for ns202604 and pvrns2021): „501/14.04.2026“, „501/14.04.2026 г.“, „№1001/16.04.2026г.“,
 * „№ 12 / 07.04.2026“, „№9 - 07.04.2026 г.“, „1234 от 06.11.2021 г.“, „501/ 14.04.2026“,
 * „501/14.04.21“, „5/9.11.2021“, „Рз-12/16.04.2026 год.“, bare „501“, and „Анулиран“ in the name column.
 * One odd row must never break a page, so every parser here returns null instead of throwing.
 */

/** Latin letters that look like Cyrillic ones in names typed into the CIK forms. */
const LOOKALIKES: Record<string, string> = {
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', i: 'і',
}

/** Display form: NFC, Latin look-alikes → Cyrillic, one space, dashes as „-“, no spaces around „-“. */
export function cleanName(raw: string) {
  return raw
    .normalize('NFC')
    .replace(/[\u00a0\u2000-\u200b\u202f]/g, ' ')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[A-Za-z]/g, (ch) => LOOKALIKES[ch] ?? ch)
    .replace(/і/g, 'и')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Match key, as last election's sheet did it: lower case, no spaces and no hyphens
 * (LOWER(REGEXREPLACE(name, "[ -]", ""))). Also folds ѝ/й and ё/е.
 */
export function nameKey(raw: string) {
  return cleanName(raw)
    .toLocaleLowerCase('bg')
    .replace(/ѝ/g, 'и')
    .replace(/ё/g, 'е')
    .replace(/[\s\-.'’`"]/g, '')
}

export function joinNames(first: string, middle: string, last: string) {
  return cleanName([first, middle, last].filter((part) => part && part.trim()).join(' '))
}

/** Words that a РИК writes in the name column instead of a person. */
export function isAnnulledName(raw: string) {
  return /^(анулиран[аио]?|заличен[аио]?|отказ)(?![а-яё])/iu.test(cleanName(raw))
}

/** dd.mm.yyyy from „14.04.2026“, „9.11.2021“, „14.04.26“, „14.042026“; null when it is not a date. */
export function normalizeDate(raw: string): string | null {
  const text = raw.trim()
  let match = text.match(/(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{2,4})/)
  if (!match) {
    const glued = text.match(/(\d{1,2})\.(\d{2})(\d{4})/)
    if (!glued) return null
    match = glued
  }
  const day = Number(match[1])
  const month = Number(match[2])
  let year = Number(match[3])
  if (match[3]!.length === 2) year += 2000
  if (match[3]!.length === 3) return null
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`
}

export interface ParsedNumber {
  /** The пълномощно number, or null when the cell has none. */
  number: number | null
  /** dd.mm.yyyy, or null when the cell has no readable date (e.g. a bare „501“). */
  date: string | null
  /** Letters before the number, e.g. „Рз“ in „Рз-12/16.04.2026 год.“ (another organisation's series). */
  prefix: string
  raw: string
}

/** Reads a „№ и дата на пълномощното“ cell in any of the shapes above. */
export function parseNumberWithDate(raw: string): ParsedNumber {
  const text = cleanName(raw).replace(/\s+г(?:од)?\.?\s*$/i, '').replace(/г\.?$/i, '').trim()
  const result: ParsedNumber = { number: null, date: null, prefix: '', raw: raw.trim() }
  if (!text) return result
  const prefix = text.match(/^№?\s*([А-Яа-яA-Za-z]{1,4})\s*-\s*(?=\d)/)
  let rest = text
  if (prefix) {
    result.prefix = prefix[1]!
    rest = text.slice(prefix[0].length)
  }
  rest = rest.replace(/^№\s*/, '')
  // number, then a separator („/“, „-“, „от“) or nothing, then the date
  const full = rest.match(/^(\d{1,6})\s*(?:\/|-|от|\s)\s*(.+)$/i)
  if (full) {
    result.number = Number(full[1])
    result.date = normalizeDate(full[2]!)
    if (!result.date) {
      // „Рз-1234.04.2026“: the slash is missing, the number cannot be told from the day.
      result.number = null
    }
    return result
  }
  const bare = rest.match(/^(\d{1,6})$/)
  if (bare) result.number = Number(bare[1])
  return result
}

/** „№ 69-ПВР / 20.10.2026“, „Решение № 125-НС/16.04.2026“ → { number: 69, suffix: 'ПВР', date }. */
export function parseDecisionNumber(raw: string) {
  const match = cleanName(raw).match(/№\s*(\d+)\s*-\s*([А-Я]+(?:\/[А-Я]+)*)\s*(?:\/|от)?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})?/)
  if (!match) return null
  return { number: Number(match[1]), suffix: match[2]!, date: match[3] ? normalizeDate(match[3]) : null }
}

/**
 * Masked ЕГН as some registers print it („850101****“, „******1234“). The представители
 * registers on the CIK platform print no ЕГН at all, so matching never depends on it;
 * this only checks that a masked value is consistent with the full one.
 */
export function maskedEgnMatches(masked: string, egn: string) {
  const mask = masked.replace(/\s/g, '')
  const full = egn.replace(/\D/g, '')
  if (mask.length !== 10 || full.length !== 10) return false
  for (let i = 0; i < 10; i += 1) {
    const ch = mask[i]!
    if (/\d/.test(ch) && ch !== full[i]) return false
  }
  return /\d/.test(mask)
}

/** Levenshtein distance, capped; for „one letter off“ name hints. */
export function editDistance(a: string, b: string, cap = 4) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i]
    let best = i
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(prev[j]! + 1, next[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      next.push(value)
      if (value < best) best = value
    }
    if (best > cap) return cap + 1
    prev = next
  }
  return prev[b.length]!
}

/** SHA-256 hex of a string (Workers and Node both have crypto.subtle). */
export async function sha256Hex(text: string) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

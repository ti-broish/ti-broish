/**
 * Parsers for the CIK election site that every РИК and CIK itself run
 * (rikNN.cik.bg/<election>/registers/... and www.cik.bg/bg/<election>/registers/...).
 * Plain string parsing, no DOM, so the same code runs in the Worker and in the tests.
 *
 * What the pages look like (surveyed on all 31 РИК for ns202604 and pvrns2021, the current
 * pvr2026 pages and CIK's abroad register):
 * - A register's first page is either „В момента няма въведени данни в регистъра“ or one
 *   `table.table-striped` with one row per batch: „№ по ред, дата“ and the party/committee
 *   linking to the batch (`register_p?id=7134` on a РИК, `/register_p/7166` on CIK, `/advocates/8422`).
 * - Some РИК keep one batch per party that keeps growing (РИК 23: one page, 548 rows); others
 *   add a batch per decision (РИК 02: 7, РИК 17: 8) and may empty an older batch after merging it.
 * - A batch page has an <h4> with the party and a two-column table: name, „№ и дата на пълномощното“
 *   (advocates: name, „№ на удостоверение“). No ЕГН, masked or not.
 * - Each page also carries a calendar `table.table` in the sidebar, which is not a register.
 * - No register page was paginated in any surveyed election, but `?page=N` links inside the
 *   content are followed in case a РИК turns paging on.
 */
import { cleanName } from './normalize'

export function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&bdquo;/g, '„')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

export function textOf(html: string) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function withoutScripts(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
}

/** The main column, before the sidebar with the calendar and the latest decisions. */
function mainColumn(html: string) {
  const clean = withoutScripts(html)
  const end = clean.indexOf('calendar-col')
  return end > 0 ? clean.slice(0, end) : clean
}

function registerTables(html: string) {
  return [...mainColumn(html).matchAll(/<table[^>]*class="[^"]*table-striped[^"]*"[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]!)
}

function rowsOf(table: string) {
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]!)
}

function cellsOf(row: string) {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]!)
}

function headersOf(table: string) {
  return [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => textOf(m[1]!))
}

export function absoluteUrl(href: string, base: string) {
  try {
    return new URL(decodeEntities(href), base).toString()
  } catch {
    return ''
  }
}

const EMPTY_TEXT = /няма въведени данни|няма регистрирани/i

export interface RegisterBatch {
  /** „1/14.04.2026“ or „1“ (advocates). */
  listNo: string
  party: string
  url: string
  /** Decision links in the advocates list („Решение № 125-НС/16.04.2026“). */
  decisions: string[]
}

export interface RegisterListPage {
  empty: boolean
  headers: string[]
  batches: RegisterBatch[]
  pages: string[]
  /** Set when the page is not a register at all (a redirect to the home page, an error page). */
  unrecognised: boolean
}

/** Same-register paging links inside the main column („?page=2“, „/page/2“). */
function pagingLinks(html: string, url: string) {
  const out = new Set<string>()
  const main = mainColumn(html)
  for (const m of main.matchAll(/href="([^"]*(?:[?&](?:page|p|start)=\d+|\/page\/\d+)[^"]*)"/gi)) {
    const next = absoluteUrl(m[1]!, url)
    if (next && next !== url && !/calendar|decisions/.test(next)) out.add(next)
  }
  return [...out]
}

export function parseRegisterList(html: string, url: string): RegisterListPage {
  const tables = registerTables(html)
  const main = mainColumn(html)
  const empty = EMPTY_TEXT.test(textOf(main.slice(main.indexOf('breadcrumb') > 0 ? main.indexOf('breadcrumb') : 0)))
  const batches: RegisterBatch[] = []
  let headers: string[] = []
  for (const table of tables) {
    headers = headersOf(table)
    for (const row of rowsOf(table)) {
      const cells = cellsOf(row)
      if (cells.length < 2) continue
      const link = cells[1]!.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      if (!link) continue
      const decisions = cells.slice(2).flatMap((cell) => [...cell.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => textOf(m[1]!)))
      batches.push({ listNo: textOf(cells[0]!).replace(/\s*\/\s*/g, '/'), party: cleanName(textOf(link[2]!)), url: absoluteUrl(link[1]!, url), decisions })
    }
  }
  const looksLikeRegister = /registers/.test(url) && (tables.length > 0 || empty)
  return { empty: empty && batches.length === 0, headers, batches, pages: pagingLinks(html, url), unrecognised: !looksLikeRegister }
}

export interface RegisterRow {
  name: string
  number: string
  /** Position on the page, 0-based. */
  index: number
}

export interface RegisterBatchPage {
  party: string
  headers: string[]
  rows: RegisterRow[]
  empty: boolean
  pages: string[]
  unrecognised: boolean
}

export function parseRegisterBatch(html: string, url: string): RegisterBatchPage {
  const main = mainColumn(html)
  const tables = registerTables(html)
  const heading = main.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)
  const rows: RegisterRow[] = []
  let headers: string[] = []
  for (const table of tables) {
    headers = headersOf(table)
    for (const row of rowsOf(table)) {
      const cells = cellsOf(row).map(textOf)
      if (cells.length < 2) continue
      // name first, number last; tolerate an extra „№ по ред“ column in front
      const named = cells.length >= 3 && /^\d+\.?$/.test(cells[0]!) ? cells.slice(1) : cells
      rows.push({ name: cleanName(named[0]!), number: named[named.length - 1]!.trim(), index: rows.length })
    }
  }
  const empty = rows.length === 0 && EMPTY_TEXT.test(textOf(main))
  return {
    party: heading ? cleanName(textOf(heading[1]!)) : '',
    headers,
    rows,
    empty,
    pages: pagingLinks(html, url),
    unrecognised: rows.length === 0 && !empty,
  }
}

export interface RikIndexEntry {
  mir: string
  name: string
  homeUrl: string
  contactsUrl: string
  membersUrl: string
}

/** www.cik.bg/bg/<election>/rik: one block per РИК with its home, „Състав“ and „Контакти“ links. */
export function parseRikIndex(html: string, url: string): RikIndexEntry[] {
  const clean = withoutScripts(html)
  const out = new Map<string, RikIndexEntry>()
  for (const m of clean.matchAll(/<a[^>]*href="([^"]*rik(\d{2})\.cik\.bg[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = absoluteUrl(m[1]!.startsWith('//') ? `https:${m[1]}` : m[1]!, url)
    const mir = m[2]!
    const label = textOf(m[3]!)
    const entry = out.get(mir) ?? { mir, name: '', homeUrl: '', contactsUrl: '', membersUrl: '' }
    if (/\/contacts\/?$/.test(href)) entry.contactsUrl = href
    else if (/\/members\/?$/.test(href)) entry.membersUrl = href
    else if (!entry.homeUrl) {
      entry.homeUrl = href
      entry.name = label
    }
    out.set(mir, entry)
  }
  return [...out.values()].filter((entry) => entry.homeUrl).sort((a, b) => a.mir.localeCompare(b.mir))
}

/** The election's own base on a РИК site: the contacts link minus „/contacts“ (e.g. https://rik01.cik.bg/pvr2026). */
export function electionBaseOf(entry: RikIndexEntry, election: string) {
  if (entry.contactsUrl) return entry.contactsUrl.replace(/\/contacts\/?$/, '')
  return `${entry.homeUrl.replace(/\/+$/, '')}/${election}`
}

/** Cloudflare's email obfuscation: the first byte is the XOR key. */
export function decodeCfEmail(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4) return ''
  const key = parseInt(hex.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
  return out
}

export interface RikContacts {
  phones: string[]
  email: string
  address: string
}

/** /<election>/contacts: „Адрес …“, „Телефон: …“ (several, with roles), a protected email. */
export function parseContacts(html: string): RikContacts {
  const main = mainColumn(html)
  const text = textOf(main)
  const start = text.search(/Телефон/i)
  const stop = text.search(/email:|e-mail|website:/i)
  const phoneText = start >= 0 ? text.slice(start, stop > start ? stop : undefined) : ''
  const phones = [...new Set([...phoneText.matchAll(/(?:\+359[\s-]?|\b0)\d[\d\s/-]{5,14}\d/g)].map((m) => m[0].replace(/\s+/g, ' ').trim()))]
  const cf = main.match(/data-cfemail="([0-9a-f]+)"/i)
  const plain = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)
  const address = text.match(/Адрес\s+(.+?)\s+Контакти/)
  return { phones: phones.slice(0, 6), email: cf ? decodeCfEmail(cf[1]!) : plain ? plain[0] : '', address: address ? address[1]!.slice(0, 200) : '' }
}

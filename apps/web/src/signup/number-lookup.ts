/**
 * Search by пълномощно number and the „История на номера“ timeline, both read from the number
 * ledger (designation_numbers) plus the РИК register rows (rik_entries). Read-only.
 *
 * „23/514“ looks up one МИР; a bare „514“ looks the number up in every МИР.
 */
import { looksLikeSamePerson } from './rik/match'
import { nameKey } from './rik/normalize'

export interface NumberQuery {
  /** Two-digit МИР, or '' for every МИР. */
  mir: string
  number: number
}

/** „23/514“, „23 / 514“, „1/515“ (→ 01) or a bare „514“. Anything else is not a number search. */
export function parseNumberQuery(value: string): NumberQuery | null {
  const raw = value.trim()
  const pair = /^(\d{1,2})\s*\/\s*(\d{1,3})$/.exec(raw)
  if (pair) {
    const number = Number(pair[2])
    const mir = pair[1]!.padStart(2, '0')
    return number >= 1 && mir !== '00' ? { mir, number } : null
  }
  const bare = /^(\d{1,3})$/.exec(raw)
  if (bare && Number(bare[1]) >= 1) return { mir: '', number: Number(bare[1]) }
  return null
}

export type LedgerState = 'active' | 'moved' | 'withdrawn' | 'released' | 'external'
export type Holder = 'signup' | 'partner' | 'external'

export interface LedgerRow {
  mir: string
  number: number
  issued_on: string
  holder: Holder
  person_id: string | null
  state: LedgerState
  moved_to: string
  name: string
  rik_url: string
  note: string
  created_at: string
}

export interface RegisterRow {
  mir: string
  number: number
  name: string
  name_key: string
  annulled: number
  missing_since: string | null
  source_url: string
}

export type PresenceState = 'published' | 'annulled' | 'gone' | 'not_published' | 'other'

export interface Presence {
  state: PresenceState
  /** „в РИК 23: публикуван“ etc. */
  label: string
  /** The register page the row came from, or the МИР's register. '' when unknown. */
  url: string
  /** A „Анулиран“ row exists next to a live one. */
  annulledToo: boolean
}

/**
 * Where a number stands in the РИК register. `personKey` (our holder's name key) tells our person's
 * row from somebody else's under the same number; without it any named row counts.
 */
export function registerPresence(mir: string, rows: RegisterRow[], fallbackUrl = '', personKey = ''): Presence {
  const live = rows.filter((row) => !row.missing_since)
  const named = rows.filter((row) => Number(row.annulled) !== 1)
  const liveNamed = live.filter((row) => Number(row.annulled) !== 1)
  const annulled = rows.some((row) => Number(row.annulled) === 1)
  const url = (liveNamed[0] ?? live[0] ?? rows[0])?.source_url || fallbackUrl
  const where = `в РИК ${mir}`
  const isOurs = (row: RegisterRow) => !personKey || looksLikeSamePerson(personKey, row.name_key)
  if (liveNamed.length) {
    if (!liveNamed.some(isOurs)) return { state: 'other', label: `${where}: под този номер е друг човек`, url, annulledToo: annulled }
    const tail = annulled ? ' (имаше и ред „Анулиран“)' : ''
    return { state: 'published', label: `${where}: публикуван ✓${tail}`, url, annulledToo: annulled }
  }
  if (live.some((row) => Number(row.annulled) === 1)) {
    const gone = named.length ? ', редът с името изчезна' : ''
    return { state: 'annulled', label: `${where}: „Анулиран“${gone}`, url, annulledToo: true }
  }
  if (rows.length) return { state: 'gone', label: `${where}: вече не е в регистъра`, url, annulledToo: annulled }
  return { state: 'not_published', label: `${where}: не е публикуван`, url: fallbackUrl, annulledToo: false }
}

export const STATE_LABELS: Record<LedgerState, string> = {
  active: 'текущ',
  moved: 'преместен',
  withdrawn: 'отписан',
  released: 'освободен',
  external: 'Външен (РИК)',
}

export interface PersonRef {
  id: string
  source: 'signup' | 'partner'
  name: string
  mir: string
  number: number | null
  signedAt: string | null
}

export interface NumberCard {
  label: string
  mir: string
  number: number
  issuedOn: string
  state: LedgerState
  stateLabel: string
  holder: Holder
  /** Our holder (also for moved/withdrawn), null for an external row. */
  person: PersonRef | null
  /** „26/525“ when the number moved. */
  movedTo: string
  /** Who the РИК shows under this number when that is not one of ours. */
  external: { name: string; url: string } | null
  register: Presence
  note: string
}

const label = (mir: string, number: number | null) => (number == null ? mir : `${mir}/${number}`)

export function buildCards(
  ledger: LedgerRow[],
  register: RegisterRow[],
  people: Map<string, PersonRef>,
  registerUrls: Map<string, string> = new Map(),
): NumberCard[] {
  return ledger.map((row) => {
    const number = Number(row.number)
    const rows = register.filter((one) => one.mir === row.mir && Number(one.number) === number)
    const person = row.person_id ? (people.get(row.person_id) ?? null) : null
    const ours = row.holder !== 'external'
    const register_ = registerPresence(row.mir, rows, registerUrls.get(row.mir) ?? '', ours && person ? nameKey(person.name) : '')
    const external = !ours || row.name ? { name: row.name, url: row.rik_url || register_.url } : null
    return {
      label: label(row.mir, number),
      mir: row.mir,
      number,
      issuedOn: row.issued_on,
      state: row.state,
      stateLabel: STATE_LABELS[row.state] ?? row.state,
      holder: row.holder,
      person: ours ? person : null,
      movedTo: row.moved_to,
      external,
      register: register_,
      note: row.note,
    }
  })
}

/** The timeline is oldest first: numbers the person left, then the one they hold (or held when withdrawn). */
export function sortHistory(rows: LedgerRow[]) {
  const rank = (state: LedgerState) => (state === 'active' || state === 'withdrawn' ? 1 : 0)
  return [...rows].sort((a, b) => rank(a.state) - rank(b.state) || issuedKey(a.issued_on).localeCompare(issuedKey(b.issued_on)) || a.created_at.localeCompare(b.created_at) || a.mir.localeCompare(b.mir) || a.number - b.number)
}

/** „22.10.2026“ → „2026-10-22“ for ordering; anything else sorts as is. */
function issuedKey(value: string) {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(value)
  return match ? `${match[3]}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}` : value
}

export const LEDGER_COLUMNS = 'mir, number, issued_on, holder, person_id, state, moved_to, name, rik_url, note, created_at'

/** ?1 number, ?2 МИР or '' for all. */
export const NUMBER_LOOKUP_SQL = `SELECT ${LEDGER_COLUMNS} FROM designation_numbers WHERE number = ?1 AND (?2 = '' OR mir = ?2) ORDER BY mir LIMIT 40`

/** ?1 person id. */
export const PERSON_LEDGER_SQL = `SELECT ${LEDGER_COLUMNS} FROM designation_numbers WHERE person_id = ?1 LIMIT 40`

/** Our coalition's representative rows for one number (?1), in one МИР (?2) or all (''). */
export const REGISTER_FOR_NUMBER_SQL = `SELECT mir, number, name, name_key, annulled, missing_since, source_url FROM rik_entries
WHERE ours = 1 AND kind = 'representative' AND number = ?1 AND (?2 = '' OR mir = ?2) ORDER BY first_seen_at, id`

export const REGISTER_BASES_SQL = `SELECT mir, base_url FROM rik_sources WHERE base_url != ''`

/** People behind ledger rows: id, source, name, current МИР/number, signed. ?1 JSON array of ids. */
export const LEDGER_PEOPLE_SQL = `
SELECT id, 'signup' AS source,
  trim(COALESCE(json_extract(payload, '$.firstName'), '') || ' ' || COALESCE(json_extract(payload, '$.middleName'), '') || ' ' || COALESCE(json_extract(payload, '$.lastName'), '')) AS name,
  COALESCE(designation_mir, '') AS mir, designation_number AS number, designation_signed_at AS signed_at
FROM signups WHERE id IN (SELECT value FROM json_each(?1))
UNION ALL
SELECT id, 'partner', trim(COALESCE(first_name, '') || ' ' || COALESCE(middle_name, '') || ' ' || COALESCE(last_name, '')),
  COALESCE(designation_mir, ''), designation_number, designation_signed_at
FROM partner_people WHERE id IN (SELECT value FROM json_each(?1))`

export function registerUrlsFrom(rows: Array<{ mir: string; base_url: string }>) {
  return new Map(rows.map((row) => [row.mir, `${row.base_url.replace(/\/$/, '')}/registers/register_p`]))
}

export function peopleFrom(rows: Array<{ id: string; source: string; name: string; mir: string; number: number | null; signed_at: string | null }>) {
  return new Map(
    rows.map((row): [string, PersonRef] => [
      row.id,
      {
        id: row.id,
        source: row.source === 'partner' ? 'partner' : 'signup',
        name: row.name.replace(/\s+/g, ' ').trim(),
        mir: String(row.mir ?? '').padStart(row.mir ? 2 : 0, '0'),
        number: row.number == null ? null : Number(row.number),
        signedAt: row.signed_at || null,
      },
    ]),
  )
}

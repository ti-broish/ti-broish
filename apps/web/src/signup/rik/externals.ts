/**
 * External numbers („външни“): rows of our committee's представители register whose name is none of
 * our people. Someone outside our database got that number (e.g. through the person who signs our
 * пълномощни), so it is reserved in the number ledger (designation_numbers) and never issued by us.
 * Runs at the end of every РИК sync (rematch), name first: a row that names one of ours is theirs,
 * whatever its number.
 *
 * Only what the РИК publishes is stored: the name (none for „Анулиран“), the number's date and the
 * page. A number we used ourselves (moved, released, withdrawn) keeps its row and state; it only gets
 * the external holder attached. A row never goes away: a number that leaves the register stays taken.
 */
import type { SignupD1 } from '../db-core'
import { looksLikeSamePerson, ownersOf, type DerivedTask, type MatchIndex, type RikEntryRow } from './match'

/** Someone in our database without a пълномощно number (never linked automatically). */
export interface UnnumberedPerson {
  id: string
  nameKey: string
}

export interface ExternalNumber {
  mir: string
  number: number
  issuedOn: string
  /** As published; '' when the only row reads „Анулиран“. */
  name: string
  entryId: string
  url: string
  /** For a number only external: its whole note. */
  note: string
  /** Appended to a number we used ourselves. */
  ourNote: string
  /** Unnumbered people of ours whose name looks like the published one. */
  possible: string[]
}

/** Our numbers in the ledger (any state): „МИР:number“. */
export type LedgerOurs = Set<string>

const MAX_NUMBER = 999

function pick(rows: RikEntryRow[]) {
  // Named over „Анулиран“ (the name is who held it), live over gone, then first seen (input order).
  return [...rows].sort((a, b) => Number(a.annulled) - Number(b.annulled) || Number(!!a.missingSince) - Number(!!b.missingSince))[0]!
}

export function findExternalNumbers(entries: RikEntryRow[], index: MatchIndex, ledgerOurs: LedgerOurs, unnumbered: UnnumberedPerson[] = []) {
  const groups = new Map<string, RikEntryRow[]>()
  for (const row of entries) {
    if (!row.ours || row.kind !== 'representative' || row.number == null) continue
    if (row.number < 1 || row.number > MAX_NUMBER || !/^\d\d$/.test(row.mir)) continue
    const key = `${row.mir}:${row.number}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const numbers: ExternalNumber[] = []
  const tasks: DerivedTask[] = []
  for (const [key, rows] of groups) {
    // Any row naming one of ours: the number is ours (a typo or a mix-up is the matcher's task).
    if (rows.some((row) => ownersOf(row, index).length > 0)) continue
    const named = rows.filter((row) => !row.annulled)
    // Only „Анулиран“ under a number we issued: our own annulled row.
    if (named.length === 0 && ledgerOurs.has(key)) continue
    const row = pick(rows)
    const mir = row.mir
    const number = row.number!
    const annulled = rows.some((one) => one.annulled)
    const gone = !!row.missingSince
    const name = row.annulled ? '' : row.name
    const possible = name
      ? unnumbered.filter((person) => person.nameKey && looksLikeSamePerson(person.nameKey, row.nameKey)).map((person) => person.id)
      : []
    const note = [`в регистъра на РИК ${mir}`, annulled ? 'Анулиран' : '', gone ? 'вече не е в регистъра' : '', possible.length ? 'Възможно съвпадение' : '']
      .filter(Boolean)
      .join(', ')
    numbers.push({ mir, number, issuedOn: row.numberDate ?? '', name, entryId: row.id, url: row.sourceUrl ?? '', note, ourNote: `зает външно в РИК ${mir}`, possible })
    for (const personId of possible) {
      tasks.push({
        id: `${personId}:possible_match:${mir}/${number}`,
        personId,
        mir,
        type: 'possible_match',
        reason: 'external',
        detail: `РИК ${mir} е публикувал „${row.name}“ под № ${number}${row.numberDate ? `/${row.numberDate}` : ''} за нашия комитет. Прилича на този човек, който няма номер при нас. Не е свързан автоматично: провери дали е същият.`,
      })
    }
  }
  numbers.sort((a, b) => a.mir.localeCompare(b.mir) || a.number - b.number)
  return { numbers, tasks }
}

/**
 * Upsert one external number. A new number → an „external“ row. An external row → refreshed from the
 * register. Our own row (moved, released, withdrawn or, with a „renumber“ task, active) keeps its
 * holder and state and gets the external holder attached. Writes only when something changed.
 */
export const EXTERNAL_NUMBER_UPSERT_SQL = `INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note, created_at, updated_at)
VALUES (?1, ?2, ?3, 'external', NULL, 'external', '', ?4, ?5, ?6, ?7, ?9, ?9)
ON CONFLICT(mir, number) DO UPDATE SET
  name = excluded.name,
  rik_entry_id = excluded.rik_entry_id,
  rik_url = excluded.rik_url,
  issued_on = CASE WHEN designation_numbers.holder = 'external' THEN excluded.issued_on ELSE designation_numbers.issued_on END,
  note = CASE
    WHEN designation_numbers.holder = 'external' THEN excluded.note
    WHEN instr(designation_numbers.note, ?8) > 0 THEN designation_numbers.note
    WHEN designation_numbers.note = '' THEN ?8
    ELSE designation_numbers.note || '; ' || ?8 END,
  updated_at = excluded.updated_at
WHERE designation_numbers.name IS NOT excluded.name
  OR designation_numbers.rik_entry_id IS NOT excluded.rik_entry_id
  OR designation_numbers.rik_url IS NOT excluded.rik_url
  OR (designation_numbers.holder = 'external' AND (designation_numbers.note IS NOT excluded.note OR designation_numbers.issued_on IS NOT excluded.issued_on))
  OR (designation_numbers.holder != 'external' AND instr(designation_numbers.note, ?8) = 0)`

export function externalNumberStatements(db: SignupD1, numbers: ExternalNumber[], stamp: string) {
  return numbers.map((one) =>
    db.prepare(EXTERNAL_NUMBER_UPSERT_SQL).bind(one.mir, one.number, one.issuedOn, one.name, one.entryId, one.url, one.note, one.ourNote, stamp),
  )
}

/** Our ledger: numbers we used („МИР:number“) and every МИР each person held a number in. */
export const LEDGER_OURS_SQL = `SELECT mir, number, person_id FROM designation_numbers WHERE holder != 'external'`

/** People without a number, for „Възможно съвпадение“ only. */
export const UNNUMBERED_PEOPLE_SQL = `
SELECT id, COALESCE(json_extract(payload, '$.firstName'), '') AS first_name, COALESCE(json_extract(payload, '$.middleName'), '') AS middle_name,
       COALESCE(json_extract(payload, '$.lastName'), '') AS last_name
FROM signups WHERE designation_number IS NULL AND COALESCE(withdrawn, 0) = 0
UNION ALL
SELECT id, COALESCE(first_name, ''), COALESCE(middle_name, ''), COALESCE(last_name, '')
FROM partner_people WHERE designation_number IS NULL AND withdrawn_at IS NULL`

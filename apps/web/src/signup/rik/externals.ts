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

/** A register number of one of ours who moved to another МИР since (see RECLAIMED_NUMBER_UPSERT_SQL). */
export interface ReclaimedNumber {
  mir: string
  number: number
  issuedOn: string
  holder: 'signup' | 'partner'
  personId: string
  movedTo: string
  entryId: string
  url: string
  note: string
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
  const reclaimed: ReclaimedNumber[] = []
  const tasks: DerivedTask[] = []
  /** Our own numbers that an earlier run marked „зает външно“ but whose row now names their holder. */
  const cleared: Array<{ mir: string; number: number }> = []
  for (const [key, rows] of groups) {
    // Any row naming one of ours: the number is ours (a typo or a mix-up is the matcher's task).
    const owned = rows.find((row) => ownersOf(row, index).length > 0)
    if (owned) {
      const owners = [...new Map(rows.flatMap((row) => ownersOf(row, index)).map((one) => [one.id, one])).values()]
      const owner = owners.length === 1 ? owners[0]! : null
      if (ledgerOurs.has(key) && owners.some((one) => one.mir === owned.mir && one.number === owned.number)) {
        cleared.push({ mir: owned.mir, number: owned.number! })
      }
      // Registered here for one of ours who has since moved to another МИР (31 → 32): our old number.
      if (owner && owner.number != null && owner.mir !== owned.mir && !ledgerOurs.has(key)) {
        const annulled = rows.some((one) => one.annulled)
        reclaimed.push({
          mir: owned.mir,
          number: owned.number!,
          issuedOn: owned.numberDate ?? '',
          holder: owner.source,
          personId: owner.id,
          movedTo: `${owner.mir}/${owner.number}`,
          entryId: owned.id,
          url: owned.sourceUrl ?? '',
          note: [`в регистъра на РИК ${owned.mir}`, annulled ? 'Анулиран' : '', `преместен в РИК ${owner.mir}`].filter(Boolean).join(', '),
        })
      }
      continue
    }
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
  reclaimed.sort((a, b) => a.mir.localeCompare(b.mir) || a.number - b.number)
  cleared.sort((a, b) => a.mir.localeCompare(b.mir) || a.number - b.number)
  return { numbers, reclaimed, tasks, cleared }
}

/**
 * Drops the „зает външно в РИК NN“ note and the published name from our own number once its row is
 * recognised as its holder's (e.g. a part of the name written differently). Writes only when the
 * note is there.
 */
export const EXTERNAL_NOTE_CLEAR_SQL = `UPDATE designation_numbers SET
  name = '',
  note = TRIM(REPLACE(REPLACE(note, '; ' || ?3, ''), ?3, ''), '; '),
  updated_at = ?4
WHERE mir = ?1 AND number = ?2 AND holder != 'external' AND instr(note, ?3) > 0`

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

export function externalNumberStatements(
  db: SignupD1,
  numbers: ExternalNumber[],
  stamp: string,
  reclaimed: ReclaimedNumber[] = [],
  cleared: Array<{ mir: string; number: number }> = [],
) {
  return [
    ...cleared.map((one) => db.prepare(EXTERNAL_NOTE_CLEAR_SQL).bind(one.mir, one.number, `зает външно в РИК ${one.mir}`, stamp)),
    ...numbers.map((one) =>
      db.prepare(EXTERNAL_NUMBER_UPSERT_SQL).bind(one.mir, one.number, one.issuedOn, one.name, one.entryId, one.url, one.note, one.ourNote, stamp),
    ),
    ...reclaimed.map((one) =>
      db.prepare(RECLAIMED_NUMBER_UPSERT_SQL).bind(one.mir, one.number, one.issuedOn, one.holder, one.personId, one.movedTo, one.entryId, one.url, one.note, stamp),
    ),
  ]
}

/**
 * A number the РИК registered for one of ours who has since moved to another МИР: ours, „moved“
 * to their current number, still blocked. Inserted when missing; an „external“ row (the
 * number-first backfill could not know the name) is relabelled. Our own rows are never touched.
 */
export const RECLAIMED_NUMBER_UPSERT_SQL = `INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, moved_to, name, rik_entry_id, rik_url, note, created_at, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5, 'moved', ?6, '', ?7, ?8, ?9, ?10, ?10)
ON CONFLICT(mir, number) DO UPDATE SET
  holder = excluded.holder, person_id = excluded.person_id, state = 'moved', moved_to = excluded.moved_to, name = '',
  rik_entry_id = excluded.rik_entry_id, rik_url = excluded.rik_url, note = excluded.note, updated_at = excluded.updated_at
WHERE designation_numbers.holder = 'external'`

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

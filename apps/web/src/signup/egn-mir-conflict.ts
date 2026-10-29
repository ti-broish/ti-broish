/**
 * Cross-МИР guard for assigning a section. A пълномощно is valid only in its МИР; when the same ЕГН
 * already holds a number on ANOTHER row (a volunteer or an „И аз“ person) for a different МИР than
 * the section being assigned, staff see a warning naming that number and must confirm before the
 * save or publish goes through. The same МИР is fine (the number covers the whole МИР): silent.
 * The person's own number in another МИР keeps the older warn-only badge (designation-mir-guard).
 * Client-safe: SQL strings and pure helpers only.
 */
import { egnKeySql } from './designation-duplicates'
import { sectionMirOf } from './designation-mir-guard'

/** Binds ?1 the person's id (either table). Numbered, active rows other than this one with the same ЕГН. */
export const EGN_OTHER_HOLDERS_SQL = `WITH me AS (
    SELECT id, ${egnKeySql('egn')} AS k FROM signups WHERE id = ?1
    UNION ALL SELECT id, ${egnKeySql('egn')} AS k FROM partner_people WHERE id = ?1
  )
  SELECT 'signup' AS kind, s.designation_number AS number, COALESCE(s.designation_mir, '') AS mir
    FROM signups s, me
    WHERE me.k != '' AND s.id != me.id AND s.designation_number IS NOT NULL AND COALESCE(s.withdrawn, 0) = 0 AND ${egnKeySql('s.egn')} = me.k
  UNION ALL
  SELECT 'partner' AS kind, p.designation_number AS number, COALESCE(p.designation_mir, '') AS mir
    FROM partner_people p, me
    WHERE me.k != '' AND p.id != me.id AND p.designation_number IS NOT NULL AND p.withdrawn_at IS NULL AND ${egnKeySql('p.egn')} = me.k`

export interface EgnHolderRow {
  kind: 'signup' | 'partner' | string
  number: number | string | null
  mir: string | null
}

export interface EgnMirConflict {
  number: number
  mir: string
  partner: boolean
  section: string
  sectionMir: string
}

/** null when the section has no МИР, nobody else holds a number, or any holder is in the same МИР. Else the lowest number. */
export function egnMirConflict(holders: EgnHolderRow[], section: string | null | undefined): EgnMirConflict | null {
  const sectionMir = sectionMirOf(section)
  if (!sectionMir) return null
  const numbered = holders
    .map((row) => ({ number: Number(row.number), mir: String(row.mir ?? '').trim().padStart(2, '0'), partner: row.kind === 'partner' }))
    .filter((row) => Number.isFinite(row.number) && row.number > 0 && row.mir !== '00')
  if (!numbered.length || numbered.some((row) => row.mir === sectionMir)) return null
  const first = numbered.sort((a, b) => a.number - b.number)[0]!
  return { ...first, section: String(section ?? '').replace(/\D/g, ''), sectionMir }
}

export function egnMirConflictMessage(conflict: EgnMirConflict) {
  return `Внимание: това ЕГН вече има пълномощно № ${conflict.number} за МИР ${conflict.mir} (${conflict.partner ? '„И аз“' : 'доброволец'}). Секция ${conflict.section} е в МИР ${conflict.sectionMir} — пълномощното не важи там.`
}

/** The browser confirm text: the warning plus the question. */
export function egnMirConfirmText(messages: string[]) {
  return `${messages.join('\n')}\n\nДа запиша ли въпреки това?`
}

type Db = { prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } } }

export async function loadEgnMirConflict(db: Db, personId: string, section: string | null | undefined) {
  if (!sectionMirOf(section)) return null
  const rows = (await db.prepare(EGN_OTHER_HOLDERS_SQL).bind(personId).all<EgnHolderRow>()).results ?? []
  return egnMirConflict(rows, section)
}

/** Server answer when the confirm flag is missing. */
export function needsOtherMirConfirm(conflict: EgnMirConflict) {
  return { ok: false as const, needsConfirm: 'egn_other_mir' as const, message: egnMirConflictMessage(conflict), conflict }
}

export function isOtherMirConfirm(result: unknown): result is { ok: false; needsConfirm: 'egn_other_mir'; message: string } {
  return Boolean(result) && typeof result === 'object' && (result as { needsConfirm?: string }).needsConfirm === 'egn_other_mir'
}

type Ask = (text: string) => boolean
const browserAsk: Ask = (text) => typeof window !== 'undefined' && window.confirm(text)

export const NOT_SAVED_NOTE = 'Не е записано.'

/** Run a single save; on the cross-МИР answer ask staff, and re-run with the confirm flag only on „OK“. */
export async function withOtherMirConfirm<T>(run: (confirm: boolean) => Promise<T>, ask: Ask = browserAsk): Promise<T> {
  const first = await run(false)
  if (!isOtherMirConfirm(first)) return first
  if (!ask(egnMirConfirmText([first.message]))) return { ...first, message: `${first.message} ${NOT_SAVED_NOTE}` }
  return run(true)
}

/**
 * Bulk publish: run once; rows held back for the cross-МИР confirm come back in `pending`. One
 * confirm lists them all; on „OK“ re-run with their ids. Returns both runs (the second may be null).
 */
export async function withOtherMirConfirmIds<T>(
  run: (confirmIds: string[]) => Promise<T>,
  pending: (result: T) => Array<{ id: string; message: string }>,
  ask: Ask = browserAsk,
): Promise<{ first: T; second: T | null }> {
  const first = await run([])
  const rows = pending(first)
  if (!rows.length || !ask(egnMirConfirmText(rows.map((row) => row.message)))) return { first, second: null }
  return { first, second: await run(rows.map((row) => row.id)) }
}

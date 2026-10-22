/**
 * A name change on someone who already has a пълномощно (Harry, 22.10.2026). The number, its date
 * and the МИР stay; the old document carries the old name, so:
 * - generated or signed → the signing marks are cleared (designation_signing_generated_at,
 *   designation_signed_at), so the person is back in „Само новите“ / „Без подписан файл“ and the next
 *   ZIP for signing has the new name. designation_first_signed_at is kept: the signed wave and the
 *   РИК clock stay where they were. The old Drive link stays until the new signed upload replaces it.
 * - already with the РИК (first signed before that МИР's submission time, or our number is in its
 *   register) → rik_correction: the РИК page reads „Сменено име — подай поправка“ with a „Поправи
 *   името в РИК“ task until the register shows the new name; the matcher accepts the old name too.
 * Every change is kept in designation_renames (old and new name) plus an audit line.
 * No mail, no Brevo.
 */
import type { SignupD1 } from './db-core'

export const DESIGNATION_RENAMES_TABLE = `CREATE TABLE IF NOT EXISTS designation_renames (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  mir TEXT NOT NULL DEFAULT '',
  number INTEGER,
  old_name TEXT NOT NULL,
  new_name TEXT NOT NULL,
  resign INTEGER NOT NULL DEFAULT 0,
  rik_correction INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
)`

export const DESIGNATION_RENAMES_INDEX = 'CREATE INDEX IF NOT EXISTS idx_designation_renames_person ON designation_renames(person_id)'

const ensured = new WeakSet<object>()

/** Two cheap idempotent statements, once per isolate; kept out of the signup schema fingerprint on purpose. */
export async function ensureRenamesTable(db: SignupD1) {
  if (ensured.has(db)) return
  await db.prepare(DESIGNATION_RENAMES_TABLE).run()
  await db.prepare(DESIGNATION_RENAMES_INDEX).run()
  ensured.add(db)
}

export interface PersonNames {
  firstName: string
  middleName: string
  lastName: string
}

/** „Име Презиме Фамилия“ with single spaces; an empty part leaves no gap. */
export function fullName(names: PersonNames) {
  return [names.firstName, names.middleName, names.lastName]
    .map((part) => String(part ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
}

export function namesChanged(before: PersonNames, after: PersonNames) {
  return fullName(before) !== fullName(after)
}

export interface DesignationState {
  number: number | null
  mir: string
  generatedAt: string | null
  signingGeneratedAt: string | null
  signedAt: string | null
  firstSignedAt: string | null
}

/** The МИР's submission time (rik_sources.submitted_at) and whether our number is in its register. */
export interface RikState {
  mirSubmittedAt: string | null
  inRegister: boolean
}

export interface RenameDecision {
  /** The document already exists (generated, in a ZIP for signing, or signed): sign it again. */
  resign: boolean
  /** The old name already went to the РИК: send them a correction. */
  rikCorrection: boolean
}

export function renameDecision(state: DesignationState, rik: RikState): RenameDecision {
  if (state.number == null) return { resign: false, rikCorrection: false }
  const resign = Boolean(state.generatedAt || state.signingGeneratedAt || state.signedAt || state.firstSignedAt)
  const signed = state.firstSignedAt || state.signedAt
  const submittedAfterSigning =
    Boolean(signed && rik.mirSubmittedAt) && Date.parse(String(signed)) <= Date.parse(String(rik.mirSubmittedAt))
  return { resign, rikCorrection: rik.inRegister || submittedAfterSigning }
}

export type RenameTable = 'signups' | 'partner_people'

/** Back to „Само новите“: no ZIP-for-signing mark and no signed file. The wave (first signed) stays. */
export const RESIGN_SQL = (table: RenameTable) =>
  `UPDATE ${table} SET designation_signing_generated_at = NULL, designation_signed_at = NULL, updated_at = ?1 WHERE id = ?2`

export const RENAME_INSERT_SQL = `INSERT INTO designation_renames (id, person_id, mir, number, old_name, new_name, resign, rik_correction, created_at, created_by)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`

export const AUDIT_INSERT_SQL = `INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`

const STATE_SQL = (table: RenameTable) => `SELECT designation_number AS number, COALESCE(designation_mir, '') AS mir,
  designation_generated_at AS generated_at, designation_signing_generated_at AS signing_generated_at,
  designation_signed_at AS signed_at, designation_first_signed_at AS first_signed_at
  FROM ${table} WHERE id = ?`

export function resignAuditText(state: DesignationState) {
  return `№ ${state.mir}/${state.number}: ${state.signedAt ? 'подписано' : 'генерирано'} със старото име`
}

/**
 * Writes the after-rename transition for one person whose name was just changed (the caller has
 * already stored the new name). Always one „name“ audit line; with a пълномощно also the re-sign
 * marks, the rename row and a „designation_resign“ audit line. `forceRikCorrection` is for a person
 * the РИК is known to have under the old name although the dates do not show it (a partner submission).
 */
export async function applyRenameTransition(
  db: SignupD1,
  input: {
    table: RenameTable
    id: string
    before: PersonNames
    after: PersonNames
    actor: string
    now: string
    forceRikCorrection?: boolean
  },
): Promise<RenameDecision & { number: number | null; mir: string }> {
  const oldName = fullName(input.before)
  const newName = fullName(input.after)
  const row = await db.prepare(STATE_SQL(input.table)).bind(input.id).first<{
    number: number | null
    mir: string
    generated_at: string | null
    signing_generated_at: string | null
    signed_at: string | null
    first_signed_at: string | null
  }>()
  const state: DesignationState = {
    number: row?.number == null ? null : Number(row.number),
    mir: row?.mir ?? '',
    generatedAt: row?.generated_at ?? null,
    signingGeneratedAt: row?.signing_generated_at ?? null,
    signedAt: row?.signed_at ?? null,
    firstSignedAt: row?.first_signed_at ?? null,
  }
  let rik: RikState = { mirSubmittedAt: null, inRegister: false }
  if (state.number != null && state.mir) {
    const source = await db
      .prepare(`SELECT submitted_at FROM rik_sources WHERE mir = ?`)
      .bind(state.mir)
      .first<{ submitted_at: string | null }>()
      .catch(() => null)
    const entry = await db
      .prepare(`SELECT 1 AS hit FROM rik_entries WHERE mir = ? AND ours = 1 AND number = ? AND missing_since IS NULL LIMIT 1`)
      .bind(state.mir, state.number)
      .first<{ hit: number }>()
      .catch(() => null)
    rik = { mirSubmittedAt: source?.submitted_at ?? null, inRegister: Boolean(entry) }
  }
  const decision = renameDecision(state, rik)
  if (input.forceRikCorrection && state.number != null) decision.rikCorrection = true
  const statements = [db.prepare(AUDIT_INSERT_SQL).bind(crypto.randomUUID(), input.id, input.actor, 'name', oldName, newName, input.now)]
  if (decision.resign || decision.rikCorrection) {
    await ensureRenamesTable(db)
    statements.push(
      db
        .prepare(RENAME_INSERT_SQL)
        .bind(crypto.randomUUID(), input.id, state.mir, state.number, oldName, newName, decision.resign ? 1 : 0, decision.rikCorrection ? 1 : 0, input.now, input.actor),
    )
  }
  if (decision.resign) {
    statements.push(db.prepare(RESIGN_SQL(input.table)).bind(input.now, input.id))
    statements.push(
      db
        .prepare(AUDIT_INSERT_SQL)
        .bind(crypto.randomUUID(), input.id, input.actor, 'designation_resign', resignAuditText(state), decision.rikCorrection ? 'за ново подписване и поправка в РИК' : 'за ново подписване', input.now),
    )
  }
  await db.batch(statements)
  return { ...decision, number: state.number, mir: state.mir }
}

/** Old names per person with an open РИК correction, for the matcher and the „Поправки“ table. */
export const RIK_CORRECTIONS_SQL = `SELECT person_id, old_name, new_name, created_at FROM designation_renames WHERE rik_correction = 1 ORDER BY created_at`

export interface RikCorrection {
  personId: string
  oldNames: string[]
  newName: string
}

export async function loadRikCorrections(db: SignupD1): Promise<Map<string, RikCorrection>> {
  await ensureRenamesTable(db)
  const rows = (await db.prepare(RIK_CORRECTIONS_SQL).all<{ person_id: string; old_name: string; new_name: string }>()).results ?? []
  const map = new Map<string, RikCorrection>()
  for (const row of rows) {
    const current = map.get(row.person_id) ?? { personId: row.person_id, oldNames: [], newName: '' }
    if (row.old_name && !current.oldNames.includes(row.old_name)) current.oldNames.push(row.old_name)
    current.newName = row.new_name
    map.set(row.person_id, current)
  }
  return map
}

export function renameMessage(decision: RenameDecision, number: number | null, mir: string) {
  if (!decision.resign) return ''
  const which = number != null ? ` № ${mir}/${number}` : ''
  return decision.rikCorrection
    ? ` Пълномощното${which} е за ново подписване (в „Само новите“), а в РИК трябва поправка на името — виж „РИК“.`
    : ` Пълномощното${which} е за ново подписване (в „Само новите“).`
}

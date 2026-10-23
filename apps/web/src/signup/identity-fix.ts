/**
 * „Поправи име/ЕГН“ (Harry, 23.10.2026): a РИК task says the name is written differently or the
 * ЕГН does not match, and an admin fixes the person's data. Same number, same МИР; the old
 * document carries the wrong data, so it is reset carefully:
 *
 *   current ──fix──▶ awaiting_signature ──ZIP for signing──▶ in_signing ──signed upload──▶ resigned
 *
 * - fix: one audit line per changed field (ЕГН masked), the signed file goes to
 *   designation_file_history as „superseded“ (it stays in Drive and in the history), the signing
 *   marks and the current link are cleared, so the person is back in „Само новите“ and the next
 *   ZIP renders the PDF with the new data. designation_first_signed_at stays (signed wave, РИК clock).
 *   A designation_renames row (old name, old ЕГН) tracks the РИК correction; the task reads
 *   „Поправено – чака подпис“ instead of being closed.
 * - signed upload: a new Drive file (the superseded one is never overwritten), the link everywhere
 *   (profile, admin, exports) is the new one, and the history row points at its replacement.
 *   Only an eligible Ти Броиш signup gets the link in Brevo (DOCUMENT_URL); „И аз“ never does.
 *
 * Client-safe: SQL strings and pure helpers, plus applyIdentityFix over a D1-like db.
 */
import { adultOnElectionDay, UNDERAGE_REASON, validEgn } from './rules'
import { isPlaceholderEmail } from './designation-section-sql'
import { egnKey } from './designation-duplicates'
import { IDENTITY_AUDIT_SQL, identityChanges, maskEgn } from './signup-guard'
import { ensureRenamesTable, fullName, renameDecision, type DesignationState, type PersonNames, type RenameTable, type RikState } from './designation-rename'
import type { SignupD1 } from './db-core'

export interface IdentityFixValues extends PersonNames {
  /** Ten digits; '' keeps the stored ЕГН. */
  egn: string
}

export const NAME_LIMIT = 80

export function cleanName(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_LIMIT)
}

export function cleanEgn(value: unknown) {
  return String(value ?? '').replace(/\s+/g, '')
}

export type IdentityFixCheck =
  | { ok: true; after: IdentityFixValues; nameChanged: boolean; egnChanged: boolean }
  | { ok: false; message: string }

/**
 * The form against what is stored. Names as on the identity card (first and last required);
 * the ЕГН must pass the checksum and be 18 by election day, unless it is the stored one.
 */
export function checkIdentityFix(input: Partial<IdentityFixValues>, current: IdentityFixValues): IdentityFixCheck {
  const after: IdentityFixValues = {
    firstName: cleanName(input.firstName),
    middleName: cleanName(input.middleName),
    lastName: cleanName(input.lastName),
    egn: cleanEgn(input.egn) || egnKey(current.egn),
  }
  if (!after.firstName || !after.lastName) return { ok: false, message: 'Нужни са име и фамилия (както са в личната карта).' }
  if (/[0-9@]/.test(`${after.firstName}${after.middleName}${after.lastName}`)) return { ok: false, message: 'Имената не може да съдържат цифри или @.' }
  const storedEgn = egnKey(current.egn)
  if (!/^\d{10}$/.test(after.egn)) return { ok: false, message: 'ЕГН трябва да е 10 цифри.' }
  if (!validEgn(after.egn)) return { ok: false, message: 'ЕГН не е валидно (контролната цифра не съвпада).' }
  if (after.egn !== storedEgn && !adultOnElectionDay(after.egn)) return { ok: false, message: `ЕГН: човекът ${UNDERAGE_REASON}.` }
  const nameChanged = fullName(after) !== fullName(current)
  const egnChanged = after.egn !== storedEgn
  if (!nameChanged && !egnChanged) return { ok: false, message: 'Нищо не е променено: имената и ЕГН са същите.' }
  return { ok: true, after, nameChanged, egnChanged }
}

/** Where a fixed person is on the way to the РИК. null: no fix, or the fix needs no new document. */
export type FixStage = 'awaiting_signature' | 'in_signing' | 'resigned'

export const FIX_STAGE_LABELS: Record<FixStage, string> = {
  awaiting_signature: 'Поправено – чака подпис',
  in_signing: 'Поправено – свалено за подпис',
  resigned: 'Подписано наново – подай поправката в РИК',
}

/** The stage from the person's current marks, relative to the time of the fix. */
export function fixStage(input: { fixedAt: string | null; signingGeneratedAt: string | null; signedAt: string | null }): FixStage | null {
  const fixed = Date.parse(String(input.fixedAt ?? ''))
  if (!Number.isFinite(fixed)) return null
  const after = (value: string | null) => {
    const at = Date.parse(String(value ?? ''))
    return Number.isFinite(at) && at >= fixed
  }
  if (after(input.signedAt)) return 'resigned'
  if (after(input.signingGeneratedAt)) return 'in_signing'
  return 'awaiting_signature'
}

/** The document marks before the fix and what the reset does to them. */
export interface FileState extends DesignationState {
  driveFileId: string | null
  pdfUrl: string | null
}

export interface ResetPlan {
  /** A document exists (generated, in a ZIP, or signed): sign it again under the new data. */
  resign: boolean
  /** The old data already went to the РИК: track a correction. */
  rikCorrection: boolean
  /** The current signed file moves to the history as superseded (never deleted from Drive). */
  supersede: boolean
}

/** Pure: what a fix does to one person's пълномощно. From a РИК task the РИК has the old data by definition. */
export function resetPlan(state: FileState, rik: RikState, fromTask: boolean): ResetPlan {
  if (state.number == null) return { resign: false, rikCorrection: false, supersede: false }
  const decision = renameDecision(state, rik)
  const supersede = Boolean((state.driveFileId ?? '').trim() || (state.pdfUrl ?? '').trim())
  return { resign: decision.resign || supersede, rikCorrection: decision.rikCorrection || fromTask, supersede }
}

/** After the reset: the marks a person has. Pure mirror of RESET_SQL, for the state-machine tests. */
export function afterReset(state: FileState, plan: ResetPlan): FileState {
  if (!plan.resign) return state
  return { ...state, signingGeneratedAt: null, signedAt: null, driveFileId: null, pdfUrl: null }
}

/**
 * Back to „Само новите“ with no current file: the next ZIP renders the new data and the next upload
 * creates a new Drive file. designation_generated_at, number, issue date, МИР and the first-signed
 * wave stay.
 */
export const RESET_SQL = (table: RenameTable) =>
  `UPDATE ${table} SET designation_signing_generated_at = NULL, designation_signed_at = NULL,
    designation_drive_file_id = NULL, designation_pdf_url = NULL, updated_at = ?1 WHERE id = ?2`

export const DESIGNATION_FILE_HISTORY_TABLE = `CREATE TABLE IF NOT EXISTS designation_file_history (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  mir TEXT NOT NULL DEFAULT '',
  number INTEGER,
  drive_file_id TEXT NOT NULL DEFAULT '',
  pdf_url TEXT NOT NULL DEFAULT '',
  signed_at TEXT,
  reason TEXT NOT NULL,
  superseded_at TEXT NOT NULL,
  superseded_by TEXT NOT NULL,
  replaced_by_file_id TEXT,
  replaced_by_url TEXT,
  replaced_at TEXT
)`

export const DESIGNATION_FILE_HISTORY_INDEX = 'CREATE INDEX IF NOT EXISTS idx_designation_file_history_person ON designation_file_history(person_id, superseded_at)'

export const HISTORY_INSERT_SQL = `INSERT INTO designation_file_history (id, person_id, mir, number, drive_file_id, pdf_url, signed_at, reason, superseded_at, superseded_by)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`

/** On a signed upload: every superseded file of the person without a replacement now has one. */
export const HISTORY_REPLACED_SQL = `UPDATE designation_file_history SET replaced_by_file_id = ?1, replaced_by_url = ?2, replaced_at = ?3
  WHERE person_id = ?4 AND replaced_at IS NULL`

/** Columns added to designation_renames for ЕГН fixes and the task they came from. */
export const RENAMES_FIX_COLUMNS: Array<[string, string]> = [
  ['old_egn', "TEXT NOT NULL DEFAULT ''"],
  ['origin', "TEXT NOT NULL DEFAULT ''"],
  ['task_id', 'TEXT'],
]

export const FIX_RENAME_INSERT_SQL = `INSERT INTO designation_renames (id, person_id, mir, number, old_name, new_name, resign, rik_correction, created_at, created_by, old_egn, origin, task_id)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'identity_fix', ?12)`

const ensured = new WeakSet<object>()

/** History table and the extra designation_renames columns, once per isolate. Idempotent. */
export async function ensureIdentityFixTables(db: SignupD1) {
  if (ensured.has(db)) return
  await ensureRenamesTable(db)
  await db.prepare(DESIGNATION_FILE_HISTORY_TABLE).run()
  await db.prepare(DESIGNATION_FILE_HISTORY_INDEX).run()
  const info = (await db.prepare('PRAGMA table_info(designation_renames)').all<{ name: string }>()).results ?? []
  const have = new Set(info.map((row) => String(row.name)))
  for (const [column, definition] of RENAMES_FIX_COLUMNS) {
    if (have.has(column)) continue
    try {
      await db.prepare(`ALTER TABLE designation_renames ADD COLUMN ${column} ${definition}`).run()
    } catch (error) {
      if (!/duplicate column/i.test(error instanceof Error ? error.message : String(error))) throw error
    }
  }
  ensured.add(db)
}

export interface StoredIdentity {
  table: RenameTable
  id: string
  names: PersonNames
  egn: string
  email: string
  withdrawn: boolean
  file: FileState
}

export function stateSql(table: RenameTable) {
  const names =
    table === 'signups'
      ? `COALESCE(json_extract(payload, '$.firstName'), '') AS first_name, COALESCE(json_extract(payload, '$.middleName'), '') AS middle_name,
         COALESCE(json_extract(payload, '$.lastName'), '') AS last_name, COALESCE(withdrawn, 0) AS withdrawn`
      : `first_name, middle_name, last_name, CASE WHEN withdrawn_at IS NULL THEN 0 ELSE 1 END AS withdrawn`
  return `SELECT id, ${names}, COALESCE(egn, '') AS egn, COALESCE(email, '') AS email,
    designation_number AS number, COALESCE(designation_mir, '') AS mir,
    designation_generated_at AS generated_at, designation_signing_generated_at AS signing_generated_at,
    designation_signed_at AS signed_at, designation_first_signed_at AS first_signed_at,
    designation_drive_file_id AS drive_file_id, designation_pdf_url AS pdf_url
    FROM ${table} WHERE id = ?`
}

export interface StateRow {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  withdrawn: number | null
  egn: string | null
  email: string | null
  number: number | string | null
  mir: string | null
  generated_at: string | null
  signing_generated_at: string | null
  signed_at: string | null
  first_signed_at: string | null
  drive_file_id: string | null
  pdf_url: string | null
}

export function storedFromRow(table: RenameTable, row: StateRow): StoredIdentity {
  const number = row.number == null || row.number === '' ? null : Number(row.number)
  return {
    table,
    id: row.id,
    names: { firstName: String(row.first_name ?? '').trim(), middleName: String(row.middle_name ?? '').trim(), lastName: String(row.last_name ?? '').trim() },
    egn: egnKey(row.egn),
    email: String(row.email ?? '').trim(),
    withdrawn: Number(row.withdrawn ?? 0) === 1,
    file: {
      number: Number.isFinite(number) ? number : null,
      mir: String(row.mir ?? ''),
      generatedAt: row.generated_at ?? null,
      signingGeneratedAt: row.signing_generated_at ?? null,
      signedAt: row.signed_at ?? null,
      firstSignedAt: row.first_signed_at ?? null,
      driveFileId: (row.drive_file_id ?? '').trim() || null,
      pdfUrl: (row.pdf_url ?? '').trim() || null,
    },
  }
}

export async function loadStoredIdentity(db: SignupD1, table: RenameTable, id: string) {
  const row = await db.prepare(stateSql(table)).bind(id).first<StateRow>()
  return row ? storedFromRow(table, row) : null
}

/** Another person (signup or „И аз“, not withdrawn) already holds a number with this ЕГН. */
export const EGN_TAKEN_SQL = `SELECT id, designation_mir AS mir, designation_number AS number FROM signups
  WHERE REPLACE(TRIM(COALESCE(egn, '')), ' ', '') = ?1 AND id != ?2 AND designation_number IS NOT NULL AND COALESCE(withdrawn, 0) = 0
UNION ALL
SELECT id, designation_mir AS mir, designation_number AS number FROM partner_people
  WHERE REPLACE(TRIM(COALESCE(egn, '')), ' ', '') = ?1 AND id != ?2 AND designation_number IS NOT NULL AND withdrawn_at IS NULL
LIMIT 1`

export const UPDATE_SIGNUP_IDENTITY_SQL = `UPDATE signups SET
  payload = json_set(COALESCE(payload, '{}'), '$.firstName', ?1, '$.middleName', ?2, '$.lastName', ?3),
  egn = ?4, updated_at = ?5 WHERE id = ?6`

export const UPDATE_PARTNER_IDENTITY_SQL = `UPDATE partner_people SET first_name = ?1, middle_name = ?2, last_name = ?3, egn = ?4, updated_at = ?5 WHERE id = ?6`

/** rik_tasks: the fix is recorded on the task instead of closing it. */
export const TASK_FIXED_SQL = `UPDATE rik_tasks SET fixed_at = ?1, fixed_by = ?2 WHERE id = ?3 AND person_id = ?4`

export interface IdentityFixResult {
  ok: true
  plan: ResetPlan
  number: number | null
  mir: string
  nameChanged: boolean
  egnChanged: boolean
  message: string
}

export function fixMessage(plan: ResetPlan, number: number | null, mir: string, names: PersonNames) {
  const which = number != null ? ` № ${mir}/${number}` : ''
  const base = `Данните са поправени: „${fullName(names)}“.`
  if (!plan.resign) return `${base}${number != null ? ` Пълномощното${which} още не е генерирано: ще излезе с новите данни.` : ''}`
  const old = plan.supersede ? ' Старият подписан файл е в историята (не е изтрит от Drive).' : ''
  const rik = plan.rikCorrection ? ' След подписа подай поправката в РИК (таблица „Поправки“).' : ''
  return `${base} Пълномощното${which} е за ново подписване (в „Само новите“).${old}${rik}`
}

/**
 * Stores the new data and resets the document in one batch. The caller checked the role, the
 * form (checkIdentityFix) and that the ЕГН is free.
 */
export async function applyIdentityFix(
  db: SignupD1,
  input: { stored: StoredIdentity; after: IdentityFixValues; actor: string; now: string; taskId?: string | null },
): Promise<IdentityFixResult> {
  await ensureIdentityFixTables(db)
  const { stored, after, actor, now } = input
  const state = stored.file
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
  const plan = resetPlan(state, rik, Boolean(input.taskId))
  const nameChanged = fullName(after) !== fullName(stored.names)
  const egnChanged = after.egn !== stored.egn
  const statements = [
    stored.table === 'signups'
      ? db.prepare(UPDATE_SIGNUP_IDENTITY_SQL).bind(after.firstName, after.middleName, after.lastName, after.egn, now, stored.id)
      : db.prepare(UPDATE_PARTNER_IDENTITY_SQL).bind(after.firstName, after.middleName, after.lastName, after.egn, now, stored.id),
  ]
  // Before/after per field, the ЕГН masked (the same helper as the signup form's audit).
  const identity = (names: PersonNames, egn: string) => ({ name: fullName(names), email: '', phone: '', egn })
  for (const change of identityChanges(identity(stored.names, stored.egn), identity(after, after.egn))) {
    statements.push(db.prepare(IDENTITY_AUDIT_SQL).bind(crypto.randomUUID(), stored.id, actor, change.field, change.before, change.after, now))
  }
  if (plan.supersede) {
    statements.push(
      db
        .prepare(HISTORY_INSERT_SQL)
        .bind(crypto.randomUUID(), stored.id, state.mir, state.number, state.driveFileId ?? '', state.pdfUrl ?? '', state.signedAt, 'identity_fix', now, actor),
    )
  }
  if (plan.resign || plan.rikCorrection) {
    statements.push(
      db
        .prepare(FIX_RENAME_INSERT_SQL)
        .bind(
          crypto.randomUUID(),
          stored.id,
          state.mir,
          state.number,
          fullName(stored.names),
          fullName(after),
          plan.resign ? 1 : 0,
          plan.rikCorrection ? 1 : 0,
          now,
          actor,
          egnChanged ? stored.egn : '',
          input.taskId ?? null,
        ),
    )
  }
  if (plan.resign) {
    statements.push(db.prepare(RESET_SQL(stored.table)).bind(now, stored.id))
    const what = [nameChanged ? 'имена' : '', egnChanged ? 'ЕГН' : ''].filter(Boolean).join(' и ')
    statements.push(
      db
        .prepare(IDENTITY_AUDIT_SQL)
        .bind(
          crypto.randomUUID(),
          stored.id,
          actor,
          'designation_resign',
          `№ ${state.mir}/${state.number}: ${state.signedAt ? 'подписано' : 'генерирано'} със старите данни`,
          `поправка (${what})${input.taskId ? ' от задача в РИК' : ''}: за ново подписване${plan.supersede ? ', старият файл е в историята' : ''}${plan.rikCorrection ? ' и поправка в РИК' : ''}`,
          now,
        ),
    )
  }
  if (input.taskId) statements.push(db.prepare(TASK_FIXED_SQL).bind(now, actor, input.taskId, stored.id))
  await db.batch(statements)
  return { ok: true, plan, number: state.number, mir: state.mir, nameChanged, egnChanged, message: fixMessage(plan, state.number, state.mir, after) }
}

/**
 * Who gets the new link in Brevo after a signed upload: a Ти Броиш signup (never „И аз“), signed,
 * not withdrawn, with a real e-mail (not a @tibroish.invalid placeholder) and a link.
 */
export function designationLinkBrevoEligible(person: { id: string; partner: boolean; email: string; withdrawn: boolean; signed: boolean; url: string }):
  | { ok: true }
  | { ok: false; reason: 'partner' | 'withdrawn' | 'not_signed' | 'no_email' | 'no_link' } {
  if (person.partner || person.id.startsWith('pp-')) return { ok: false, reason: 'partner' }
  if (person.withdrawn) return { ok: false, reason: 'withdrawn' }
  if (!person.signed) return { ok: false, reason: 'not_signed' }
  const email = person.email.trim()
  if (!email || isPlaceholderEmail(email) || !email.includes('@')) return { ok: false, reason: 'no_email' }
  if (!person.url.trim()) return { ok: false, reason: 'no_link' }
  return { ok: true }
}

export { maskEgn }

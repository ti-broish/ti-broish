/**
 * One withdrawal for every path: admin „Отпиши“, the volunteer's „Оттегли записването“ on /profil,
 * and the backfill for people who withdrew before this existed. Frees the section, writes signup_audit
 * and cleans the Brevo contact. Brevo is best effort: a failure lands in the audit and never blocks.
 */
import {
  BREVO_CLEANED_MARK,
  brevoOutcomeAuditSuffix,
  markWithdrawalProcessedSql,
  processedAuditAfter,
  processedAuditBefore,
  unmarkWithdrawalProcessedSql,
  WITHDRAWN_COUNTS_SQL,
  withdrawnCountsFrom,
  releaseAuditBefore,
  releaseWithdrawnSql,
  restoreAuditAfter,
  restoreAuditBefore,
  restoreSql,
  SELF_WITHDRAW_REASON,
  unregisterSql,
  WITHDRAWN_HOLDING_SECTION,
  withdrawAuditAfter,
  withdrawAuditBefore,
  type BrevoListOutcome,
} from './admin-unregister'
import { cleanupWithdrawnContact, importContactsToList, readBrevoConfig, type BrevoConfig } from './brevo'
import type { SignupD1 } from './db-core'
import { hasRealEmail } from './no-email'

export type WithdrawTarget = {
  id: string
  email: string
  draft_section: string
  published_section: string
}

export type Withdrawer = {
  /** signup_audit.actor: the admin's email, or the volunteer's own email. */
  actor: string
  /** signups.withdrawn_by: the admin's email, or 'self'. */
  by: string
  reason: string
  note: string
  byAdmin: boolean
}

type BrevoConfigSource = () => BrevoConfig | { missing: string }

export async function writeSignupAudit(db: SignupD1, signupId: string, actor: string, field: string, before: string, after: string, at: string) {
  await db
    .prepare(`INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), signupId, actor, field, before, after, at)
    .run()
}

/** Brevo half of a withdrawal; the detail starts with „изчистен“ only when the contact is fully clean. */
export async function brevoWithdrawCleanup(email: string, config: BrevoConfigSource = readBrevoConfig, fetchImpl: typeof fetch = fetch): Promise<BrevoListOutcome> {
  try {
    // No e-mail: never was a Brevo contact, so it is clean without asking Brevo.
    if (!hasRealEmail(email)) return { ok: true, action: 'skipped', detail: 'изчистен, няма имейл' }
    const settings = config()
    if ('missing' in settings) return { ok: true, action: 'skipped', detail: `липсва ${settings.missing}` }
    const result = await cleanupWithdrawnContact(settings, email, fetchImpl)
    if (!result.found) return { ok: true, action: 'skipped', detail: 'изчистен, няма такъв контакт' }
    const lists = result.lists.length ? `махнат от списъци ${result.lists.join(', ')}` : 'не е в списъци'
    if (result.attributes === 'failed') {
      return { ok: false, action: 'removed', detail: `${lists}; полетата за секция не се изчистиха: ${result.attributeError ?? ''}`.slice(0, 240) }
    }
    return { ok: true, action: 'removed', detail: `изчистен, ${lists}, полетата за секция са празни` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, action: 'removed', detail: message.slice(0, 200) }
  }
}

/** True when the audit suffix of this outcome carries BREVO_CLEANED_MARK. */
export function brevoCleaned(outcome: BrevoListOutcome) {
  return brevoOutcomeAuditSuffix(outcome).includes(BREVO_CLEANED_MARK)
}

/** Active → withdrawn. Returns updated:false when the row was not active (nothing else happens then). */
export async function withdrawSignup(
  db: SignupD1,
  row: WithdrawTarget,
  who: Withdrawer,
  now: string,
  brevo: (email: string) => Promise<BrevoListOutcome> = (email) => brevoWithdrawCleanup(email),
) {
  const result = await db
    .prepare(unregisterSql())
    .bind(now, who.by, who.reason, who.note || null, who.byAdmin ? 'true' : 'false', now, row.id)
    .run()
  if (!rowChanged(result)) return { updated: false as const, brevo: null as BrevoListOutcome | null }
  const before = withdrawAuditBefore(row.draft_section, row.published_section)
  const outcome = await brevo(row.email)
  const after = withdrawAuditAfter(who.reason, who.note, row.draft_section, row.published_section) + brevoOutcomeAuditSuffix(outcome)
  await writeSignupAudit(db, row.id, who.actor, 'withdrawn', before, after, now)
  return { updated: true as const, brevo: outcome }
}

/**
 * Backfill: withdrawn people who still hold a section (the old /profil withdraw). Idempotent: a row that
 * no longer holds a section is not selected again. The withdrawal time is the row's last update.
 */
export async function releaseWithdrawnSections(
  db: SignupD1,
  now: string,
  brevo: (email: string) => Promise<BrevoListOutcome> = (email) => brevoWithdrawCleanup(email),
  limit = 20,
) {
  const rows =
    (
      await db
        .prepare(
          `SELECT id, email, COALESCE(draft_section, '') AS draft_section, COALESCE(published_section, '') AS published_section,
                  COALESCE(withdrawn_reason, '') AS reason, COALESCE(withdrawn_note, '') AS note, updated_at
           FROM signups WHERE ${WITHDRAWN_HOLDING_SECTION} ORDER BY updated_at LIMIT ?`,
        )
        .bind(limit)
        .all<WithdrawTarget & { reason: string; note: string; updated_at: string }>()
    ).results ?? []
  let released = 0
  for (const row of rows) {
    const result = await db.prepare(releaseWithdrawnSql()).bind(row.updated_at || now, 'self', SELF_WITHDRAW_REASON, now, row.id).run()
    if (!rowChanged(result)) continue
    released += 1
    const outcome = await brevo(row.email)
    const after = withdrawAuditAfter(row.reason || SELF_WITHDRAW_REASON, row.note, row.draft_section, row.published_section) + brevoOutcomeAuditSuffix(outcome)
    await writeSignupAudit(db, row.id, 'system', 'withdrawn', releaseAuditBefore(row.draft_section, row.published_section), after, now)
  }
  return { released }
}

/**
 * Re-run scope („Почисти наново“): withdrawn people with a signed пълномощно. Until v0.0.52 the
 * „Синхронизирай с Brevo“ resync pushed them back onto the Brevo list after their withdrawal cleanup.
 * `since` is when this re-run started: a person cleaned at or after it is done, so repeated clicks
 * of one re-run page through everyone once and then stop (idempotent).
 */
export const WITHDRAWN_RECLEAN_SCOPE_SQL = `COALESCE(s.withdrawn, 0) = 1 AND COALESCE(s.designation_pdf_url, '') <> ''`

/**
 * Withdrawn people whose Brevo contact was never fully cleaned (withdrawn before this existed, or Brevo failed).
 * Each gets a 'brevo_cleanup' audit row; a clean one is not picked again.
 * With `again`, withdrawn people with a signed link are cleaned once more (see WITHDRAWN_RECLEAN_SCOPE_SQL):
 * the same cleanup (off every list, section fields blanked), no deletion, no email.
 */
export async function cleanupWithdrawnBrevo(
  db: SignupD1,
  actor: string,
  now: string,
  brevo: (email: string) => Promise<BrevoListOutcome> = (email) => brevoWithdrawCleanup(email),
  limit = 25,
  again?: { since: string },
) {
  const cleanedAfter = (from: string) => `NOT EXISTS (
      SELECT 1 FROM signup_audit a WHERE a.signup_id = s.id AND a.after_text LIKE '%${BREVO_CLEANED_MARK}%'
        AND a.created_at >= ${from})`
  const pending = again
    ? `${WITHDRAWN_RECLEAN_SCOPE_SQL} AND ${cleanedAfter('?')}`
    : `COALESCE(s.withdrawn, 0) = 1 AND ${cleanedAfter("COALESCE(s.withdrawn_at, '')")}`
  const binds = again ? [again.since] : []
  const rows =
    (await db.prepare(`SELECT s.id, s.email FROM signups s WHERE ${pending} ORDER BY s.id LIMIT ?`).bind(...binds, limit).all<{ id: string; email: string }>()).results ?? []
  let cleaned = 0
  let failed = 0
  for (const row of rows) {
    const outcome = await brevo(row.email)
    if (brevoCleaned(outcome)) cleaned += 1
    else failed += 1
    await writeSignupAudit(db, row.id, actor, 'brevo_cleanup', 'Отписан', `${again ? 'Почистване наново' : 'Почистване'}${brevoOutcomeAuditSuffix(outcome)}`, now)
  }
  const left = await db.prepare(`SELECT COUNT(*) AS n FROM signups s WHERE ${pending}`).bind(...binds).first<{ n: number }>()
  return { checked: rows.length, cleaned, failed, left: Number(left?.n ?? 0) }
}

/** A save that flips withdrawn: 'withdraw' (active → withdrawn), 'return' (withdrawn → active), or null. */
export function withdrawalTurn(storedWithdrawn: number, nextWithdrawn: number): 'withdraw' | 'return' | null {
  if (storedWithdrawn !== 1 && nextWithdrawn === 1) return 'withdraw'
  if (storedWithdrawn === 1 && nextWithdrawn !== 1) return 'return'
  return null
}

export async function brevoAddBestEffort(email: string, firstName: string, lastName: string): Promise<BrevoListOutcome> {
  if (!hasRealEmail(email)) return { ok: true, action: 'skipped', detail: 'няма имейл, не е в Brevo' }
  try {
    const config = readBrevoConfig()
    if ('missing' in config) return { ok: true, action: 'skipped', detail: `липсва ${config.missing}` }
    if (!config.listId) return { ok: true, action: 'skipped', detail: 'липсва BREVO_LIST_ID' }
    await importContactsToList(config, [{ email, attributes: { FIRSTNAME: firstName, LASTNAME: lastName } }], config.listId)
    return { ok: true, action: 'added', detail: `добавен в списък ${config.listId}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, action: 'added', detail: message.slice(0, 200) }
  }
}

/** The section freed by the latest withdrawal, read back from its audit line. */
export async function lastFreedSection(db: SignupD1, signupId: string) {
  const row = await db
    .prepare(
      `SELECT after_text FROM signup_audit
       WHERE signup_id = ? AND field = 'withdrawn'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(signupId)
    .first<{ after_text: string }>()
  if (!row?.after_text) return ''
  const published = row.after_text.match(/освободена публикувана\s+([A-Z0-9]+)/i)
  if (published?.[1]) return published[1]
  const draft = row.after_text.match(/освободена чернова\s+([A-Z0-9]+)/i)
  return draft?.[1] ?? ''
}

/** Withdrawn → active (admin „Върни“, „Запиши се отново“, or „Върни записването“). The section does not come back. */
export async function restoreSignup(
  db: SignupD1,
  row: { id: string; email: string; withdrawn_reason: string; withdrawn_note: string },
  actor: string,
  now: string,
  names: { firstName: string; lastName: string },
) {
  const freed = await lastFreedSection(db, row.id)
  const result = await db.prepare(restoreSql()).bind(now, row.id).run()
  if (!rowChanged(result)) return { updated: false as const, previousSection: freed, brevo: null as BrevoListOutcome | null }
  const brevo = await brevoAddBestEffort(row.email, names.firstName, names.lastName)
  const after = restoreAuditAfter() + brevoOutcomeAuditSuffix(brevo)
  await writeSignupAudit(db, row.id, actor, 'restored', restoreAuditBefore(row.withdrawn_reason, row.withdrawn_note, freed), after, now)
  return { updated: true as const, previousSection: freed, brevo }
}

/**
 * Withdrawn person → „Обработен“ (processed=true) or back (false). Writes one signup_audit row
 * ('withdrawal_processed') when the row changed. No email, no Brevo, no section change.
 */
export async function setWithdrawalProcessed(db: SignupD1, id: string, processed: boolean, actor: string, now: string) {
  const result = processed
    ? await db.prepare(markWithdrawalProcessedSql()).bind(now, actor, now, id).run()
    : await db.prepare(unmarkWithdrawalProcessedSql()).bind(now, id).run()
  if (!rowChanged(result)) return { updated: false as const }
  await writeSignupAudit(db, id, actor, 'withdrawal_processed', processedAuditBefore(processed), processedAuditAfter(processed), now)
  return { updated: true as const }
}

/** Counts only: всички отписани, обработени, необработени. */
export async function withdrawnCounts(db: SignupD1) {
  return withdrawnCountsFrom(await db.prepare(WITHDRAWN_COUNTS_SQL).first<{ total: number; processed: number }>())
}

/** D1 reports meta.changes; when the field is missing, treat the write as applied. */
export function rowChanged(result: unknown) {
  const changes = (result as { meta?: { changes?: unknown } })?.meta?.changes
  return typeof changes === 'number' ? changes > 0 : true
}

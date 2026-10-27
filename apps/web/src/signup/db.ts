import { createServerFn } from '@tanstack/react-start'
import { getCookie, getRequestHost, getRequestUrl, setCookie } from '@tanstack/react-start/server'
import { applyCantReachReport, normalizeCantReachSection, reopenCallQueueSql } from './cant-reach'
import { CALL_REOPEN_AUDIT_SQL, callReopenAudit, callRequestFromPayload, callRequestRenewed, renewedRequestAt, reopenCalledSql } from './call-reopen'
import { profileFrom, SESSION_COOKIE, signupDatabase, type SignupD1, type SignupRow } from './db-core'
import { normalizeCallRequest, signupGap, type Profile } from './model'
import { companionsForSignup, syncCompanions } from './companion-lifecycle'
import { deliverMail, isDevMailHost } from './mail'
import { egnAgeProblem, egnProblem, signupColumns } from './record'
import { EGN_IN_USE_MESSAGE, egnDigits, egnNeedsCheck, egnUsedElsewhere } from './egn-in-use'
import { receiptClaimed, signupReceiptMail } from './receipt'
import { sessionCookieSecure } from './session-cookie'
import { SELF_WITHDRAW_REASON } from './admin-unregister'
import { IDENTITY_AUDIT_SQL, identityChanges, identityOf, OTHER_RECORD_MESSAGE, saveDecision, selfActor, type EmailRow, type SessionRow } from './signup-guard'
import { restoreSignup, withdrawalTurn, withdrawSignup } from './withdrawal'
import { SIGNUPS_CLOSED_MESSAGE, refusesNewSignup } from './signups-closed'
import { ensureRikTables } from './rik/sync'
import {
  EGN_TAKEN_SQL,
  checkIdentityFix,
  holdSelfIdentity,
  loadStoredIdentity,
  recordSelfIdentityChange,
  requestedSelfIdentity,
  type SelfIdentity,
} from './identity-fix'

function requestHost() {
  try {
    return getRequestHost()
  } catch {
    return ''
  }
}

function profileUrl() {
  try {
    const url = getRequestUrl()
    return `${url.protocol}//${url.host}/profil`
  } catch {
    return 'https://tibroish.bg/profil'
  }
}

function parsePayload(payload: string | null): Record<string, string | undefined> {
  try {
    return payload ? (JSON.parse(payload) as Record<string, string | undefined>) : {}
  } catch {
    return {}
  }
}

function changedRows(result: unknown) {
  if (!result || typeof result !== 'object') return null
  const changes = (result as { meta?: { changes?: unknown } }).meta?.changes
  return typeof changes === 'number' ? changes : null
}

async function sendSignupReceipt(db: SignupD1, id: string, profile: Profile) {
  const stamp = new Date().toISOString()
  const claimed = await db
    .prepare(
      `UPDATE signups
       SET signup_mail_at = ?
       WHERE id = ? AND (signup_mail_at IS NULL OR signup_mail_at = 'failed')
         AND submitted = 1 AND COALESCE(withdrawn, 0) = 0 AND email_confirmed = 1`,
    )
    .bind(stamp, id)
    .run()
  const changes = changedRows(claimed)
  if (changes === null) {
    await db.prepare(`UPDATE signups SET signup_mail_at = 'failed' WHERE id = ? AND signup_mail_at = ?`).bind(id, stamp).run()
    return
  }
  if (!receiptClaimed(changes)) return
  const sent = await deliverMail(signupReceiptMail(profile, profileUrl()))
  if (!sent) {
    await db.prepare(`UPDATE signups SET signup_mail_at = 'failed' WHERE id = ? AND signup_mail_at = ?`).bind(id, stamp).run()
  }
}

async function referrerName(db: NonNullable<Awaited<ReturnType<typeof signupDatabase>>>, code: string | null) {
  if (!code) return null
  const row = await db
    .prepare('SELECT payload FROM signups WHERE referral_code = ?')
    .bind(code)
    .first<{ payload: string }>()
  if (!row) return null
  const profile = JSON.parse(row.payload) as Partial<Profile>
  return [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null
}

export const saveSignup = createServerFn({ method: 'POST' })
  .validator((profile: Profile) => profile)
  .handler(async ({ data: input }) => {
    let data = input
    const db = await signupDatabase()
    if (!db || !data.email.trim()) return { ok: false as const, message: 'Липсва имейл.' }
    data = normalizeCantReachSection(normalizeCallRequest(data))
    const problem = egnProblem(data.egn)
    if (problem) return { ok: false as const, message: problem }
    const now = new Date().toISOString()
    const cookie = getCookie(SESSION_COOKIE)
    const bySession = cookie
      ? await db
          .prepare('SELECT id, email, session_token, imported, email_confirmed, pending_email FROM signups WHERE session_token = ?')
          .bind(cookie)
          .first<SessionRow>()
      : null
    const byEmail = await db
      .prepare('SELECT id, session_token, imported, email_confirmed FROM signups WHERE email = ?')
      .bind(data.email.trim().toLowerCase())
      .first<EmailRow>()
    // Never take over another record by its e-mail: only the code (checkEmailCode, /vhod) brings its session here.
    const decision = saveDecision(data.email, bySession, byEmail)
    if (decision.kind === 'refuse') return { ok: false as const, reason: decision.reason, message: decision.message }
    // Signups are closed (signups-closed.ts): only an existing record saves; nothing new is created.
    if (refusesNewSignup(decision.kind)) return { ok: false as const, reason: 'signups-closed' as const, message: SIGNUPS_CLOSED_MESSAGE }
    // email_confirmed is the server's to set (checkEmailCode), never the form's.
    data = decision.kind === 'own' ? { ...data, email: decision.email, emailConfirmed: decision.emailConfirmed } : { ...data, emailConfirmed: false }
    if (decision.kind === 'own' && decision.renameFrom !== undefined) {
      try {
        await db
          .prepare('UPDATE signups SET email = ?, email_code = NULL, pending_email = NULL WHERE id = ? AND COALESCE(email_confirmed, 0) = 0')
          .bind(decision.email, decision.row.id)
          .run()
      } catch {
        return { ok: false as const, reason: 'other-record' as const, message: OTHER_RECORD_MESSAGE }
      }
    }
    const existing = decision.kind === 'own' ? decision.row : null
    // A person with a пълномощно changes names/ЕГН only after confirming (confirmOwnIdentityChange):
    // until then the stored ones stay and the other fields save as usual.
    let identityPending: { requested: SelfIdentity; stored: SelfIdentity } | null = null
    if (existing) {
      const stored = await loadStoredIdentity(db, 'signups', existing.id)
      const requested = stored ? requestedSelfIdentity(stored, data) : null
      if (stored && requested && holdSelfIdentity(stored, requested)) {
        identityPending = { requested, stored: { ...stored.names, egn: stored.egn } }
        data = { ...data, firstName: stored.names.firstName, middleName: stored.names.middleName, lastName: stored.names.lastName, egn: stored.egn }
      }
    }
    let columns = signupColumns(data)
    if (egnAgeProblem(data.egn, null)) {
      const stored = existing
        ? await db.prepare(`SELECT COALESCE(egn, '') AS egn FROM signups WHERE id = ?`).bind(existing.id).first<{ egn: string }>()
        : null
      const ageProblem = egnAgeProblem(data.egn, stored?.egn)
      if (ageProblem) return { ok: false as const, message: ageProblem }
    }
    // One active signup per ЕГН (egn-in-use.ts). Only a new or changed ЕГН is checked.
    if (egnDigits(data.egn)) {
      const stored = existing
        ? await db.prepare(`SELECT COALESCE(egn, '') AS egn FROM signups WHERE id = ?`).bind(existing.id).first<{ egn: string }>()
        : null
      if (egnNeedsCheck(data.egn, stored?.egn) && (await egnUsedElsewhere(db, data.egn, existing?.id ?? null))) {
        // A browser without a session (decision 'new') never reaches the ЕГН step; its ЕГН is dropped
        // quietly so the answer does not tell a stranger which ЕГН are already registered.
        if (!existing) {
          data = { ...data, egn: '' }
          columns = signupColumns(data)
        } else return { ok: false as const, reason: 'egn-taken' as const, message: EGN_IN_USE_MESSAGE }
      }
    }
    const id = existing?.id ?? crypto.randomUUID()
    const token = existing?.session_token ?? crypto.randomUUID()
    const identityBefore = existing
      ? await db.prepare(`SELECT payload, COALESCE(egn, '') AS egn FROM signups WHERE id = ?`).bind(existing.id).first<{ payload: string | null; egn: string }>()
      : null
    // A new request from someone the team already called reopens it in the queue.
    const prior = existing
      ? await db
          .prepare(
            `SELECT payload, COALESCE(staff_called_at, '') AS staff_called_at, COALESCE(staff_called_by, '') AS staff_called_by,
                    email, COALESCE(withdrawn, 0) AS withdrawn, COALESCE(draft_section, '') AS draft_section,
                    COALESCE(published_section, '') AS published_section, COALESCE(withdrawn_reason, '') AS withdrawn_reason,
                    COALESCE(withdrawn_note, '') AS withdrawn_note
             FROM signups WHERE id = ?`,
          )
          .bind(existing.id)
          .first<{
            payload: string | null
            staff_called_at: string
            staff_called_by: string
            email: string
            withdrawn: number
            draft_section: string
            published_section: string
            withdrawn_reason: string
            withdrawn_note: string
          }>()
      : null
    const renewedCall = prior ? callRequestRenewed(callRequestFromPayload(prior.payload), data, prior.staff_called_at) : false
    if (prior && renewedCall) {
      data = { ...data, callRequestedAt: renewedRequestAt(data.callRequestedAt, prior.staff_called_at, now) }
      columns = signupColumns(data)
    }
    // The withdrawn flag only flips through withdrawSignup / restoreSignup below, so the seat, audit and Brevo follow it.
    const turning = prior ? withdrawalTurn(prior.withdrawn, columns.withdrawn) : null
    const storedWithdrawn = turning ? prior!.withdrawn : columns.withdrawn
    await db
      .prepare(
        `INSERT INTO signups (
           id, email, session_token, referral_code, referred_by, source, egn, role,
           rounds_first, rounds_runoff, experience, region_code, mir_code, municipality_name, town_name,
           city_region_code, city_region_name, section_place, paper_count, machine_count, radius,
           extra_city_regions, distant_region_codes, travel_municipalities, has_car, car_seats, has_drone,
           coordinator, payload, email_confirmed, consent, submitted, withdrawn, notes, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           -- staff_note, staff_called_at and staff_called_by are left untouched: a later volunteer save must not wipe the team's callback.
           session_token = excluded.session_token,
           referral_code = excluded.referral_code,
           referred_by = COALESCE(signups.referred_by, excluded.referred_by),
           source = COALESCE(signups.source, excluded.source),
           egn = COALESCE(NULLIF(excluded.egn, ''), signups.egn),
           role = excluded.role,
           rounds_first = excluded.rounds_first,
           rounds_runoff = excluded.rounds_runoff,
           experience = excluded.experience,
           region_code = excluded.region_code,
           mir_code = excluded.mir_code,
           municipality_name = excluded.municipality_name,
           town_name = excluded.town_name,
           city_region_code = excluded.city_region_code,
           city_region_name = excluded.city_region_name,
           section_place = excluded.section_place,
           paper_count = excluded.paper_count,
           machine_count = excluded.machine_count,
           radius = excluded.radius,
           extra_city_regions = excluded.extra_city_regions,
           distant_region_codes = excluded.distant_region_codes,
           travel_municipalities = excluded.travel_municipalities,
           has_car = excluded.has_car,
           car_seats = excluded.car_seats,
           has_drone = excluded.has_drone,
           coordinator = excluded.coordinator,
           payload = excluded.payload,
           email_confirmed = CASE
             WHEN signups.email_confirmed = 1 THEN 1
             WHEN COALESCE(signups.imported, 0) = 1 AND signups.email_confirmed = 0 THEN 0
             WHEN signups.email_code IS NOT NULL AND signups.email_code != '' THEN signups.email_confirmed
             ELSE excluded.email_confirmed
           END,
           consent = excluded.consent,
           submitted = excluded.submitted,
           withdrawn = excluded.withdrawn,
           notes = excluded.notes,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        columns.email,
        token,
        data.referralCode || null,
        columns.referredBy,
        columns.source,
        columns.egn,
        columns.role,
        columns.roundsFirst,
        columns.roundsRunoff,
        columns.experience,
        columns.regionCode,
        columns.mirCode,
        columns.municipalityName,
        columns.townName,
        columns.cityRegionCode,
        columns.cityRegionName,
        columns.sectionPlace,
        columns.paperCount,
        columns.machineCount,
        columns.radius,
        columns.extraCityRegions,
        columns.distantRegionCodes,
        columns.travelMunicipalities,
        columns.hasCar,
        columns.carSeats,
        columns.hasDrone,
        columns.coordinator,
        columns.payload,
        columns.emailConfirmed,
        columns.consent,
        columns.submitted,
        storedWithdrawn,
        columns.notes,
        now,
        now,
      )
      .run()
    if (prior && renewedCall) {
      const reopened = await db.prepare(reopenCalledSql()).bind(id, prior.staff_called_at).run()
      if (changedRows(reopened) !== 0) {
        const audit = callReopenAudit(prior.staff_called_at, prior.staff_called_by, data.callMessage)
        await db
          .prepare(CALL_REOPEN_AUDIT_SQL)
          .bind(crypto.randomUUID(), id, columns.email, audit.field, audit.before, audit.after, now)
          .run()
      }
    }
    if (existing && identityBefore) {
      const after = await db.prepare(`SELECT payload, COALESCE(egn, '') AS egn FROM signups WHERE id = ?`).bind(id).first<{ payload: string | null; egn: string }>()
      const changes = identityChanges(identityOf(parsePayload(identityBefore.payload), identityBefore.egn), identityOf(parsePayload(after?.payload ?? null), after?.egn ?? ''))
      for (const change of changes) {
        await db.prepare(IDENTITY_AUDIT_SQL).bind(crypto.randomUUID(), id, selfActor(columns.email), change.field, change.before, change.after, now).run()
      }
    }
    const synced = await syncCompanions(db, id, data.companions)
    data = { ...data, companions: synced.companions }
    await db.prepare('UPDATE signups SET payload = ? WHERE id = ?').bind(signupColumns(data).payload, id).run()
    if (prior && turning === 'withdraw') {
      await withdrawSignup(
        db,
        { id, email: prior.email, draft_section: prior.draft_section, published_section: prior.published_section },
        { actor: prior.email, by: 'self', reason: SELF_WITHDRAW_REASON, note: '', byAdmin: false },
        now,
      )
    } else if (prior && turning === 'return') {
      await restoreSignup(db, { id, email: prior.email, withdrawn_reason: prior.withdrawn_reason, withdrawn_note: prior.withdrawn_note }, prior.email, now, data)
    }
    // An earlier save can set submitted without a letter. The claim is what stops a second one.
    if (columns.submitted === 1 && !data.withdrawn && signupGap(data) === null && !isDevMailHost()) {
      await sendSignupReceipt(db, id, data)
    }
    setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: sessionCookieSecure(requestHost()), sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 180 })
    const countRow = data.referralCode
      ? await db.prepare('SELECT COUNT(*) AS n FROM signups WHERE referred_by = ?').bind(data.referralCode).first<{ n: number }>()
      : null
    return {
      ok: true as const,
      referrerName: await referrerName(db, columns.referredBy),
      referralCount: countRow?.n ?? 0,
      pendingLinks: synced.pendingLinks,
      renewedCallAt: renewedCall ? data.callRequestedAt : null,
      identityPending,
    }
  })

/**
 * „Да, смени“ after SELF_CHANGE_CONFIRM: the volunteer's own names/ЕГН change for a person with a
 * пълномощно. Saved with audit; the РИК task „Смяна име/ЕГН – нов документ“ is opened for staff,
 * who issue the new document (same number and МИР) from it. Nothing is reset or sent here.
 */
export const confirmOwnIdentityChange = createServerFn({ method: 'POST' })
  .validator((input: { firstName: string; middleName: string; lastName: string; egn: string }) => ({
    firstName: String(input.firstName ?? '').slice(0, 200),
    middleName: String(input.middleName ?? '').slice(0, 200),
    lastName: String(input.lastName ?? '').slice(0, 200),
    egn: String(input.egn ?? '').slice(0, 40),
  }))
  .handler(async ({ data }) => {
    const db = await signupDatabase()
    if (!db) return { ok: false as const, message: 'Няма връзка с базата. Опитай пак.' }
    const cookie = getCookie(SESSION_COOKIE)
    const session = cookie
      ? await db.prepare('SELECT id, email FROM signups WHERE session_token = ?').bind(cookie).first<{ id: string; email: string }>()
      : null
    if (!session) return { ok: false as const, message: 'Влез отново с код, за да смениш имената или ЕГН.' }
    const stored = await loadStoredIdentity(db, 'signups', session.id)
    if (!stored) return { ok: false as const, message: 'Записването не е намерено.' }
    const requested = requestedSelfIdentity(stored, data)
    if (!holdSelfIdentity(stored, requested)) return { ok: true as const, task: false, identity: { ...stored.names, egn: stored.egn } }
    const check = checkIdentityFix(requested, { ...stored.names, egn: stored.egn })
    if (!check.ok) return { ok: false as const, message: check.message.replace('ЕГН: човекът', 'ЕГН: ти') }
    if (check.egnChanged) {
      const taken = await db.prepare(EGN_TAKEN_SQL).bind(check.after.egn, stored.id).first<{ id: string }>()
      if (taken) return { ok: false as const, message: 'Това ЕГН вече е записано при друг човек. Обади се на екипа.' }
    }
    await ensureRikTables(db)
    await recordSelfIdentityChange(db, { stored, after: check.after, actor: selfActor(stored.email || session.email), now: new Date().toISOString() })
    return {
      ok: true as const,
      task: true,
      identity: { firstName: check.after.firstName, middleName: check.after.middleName, lastName: check.after.lastName, egn: check.after.egn },
    }
  })

/**
 * Volunteer reports they cannot travel to their published section.
 * Reuses the call-request fields, stores cantReachSection, and clears staff_called_*
 * so a previously closed callback returns to the open queue.
 */
export const reportCantReach = createServerFn({ method: 'POST' })
  .validator((input: { note?: string }) => ({ note: String(input?.note ?? '').trim().slice(0, 400) }))
  .handler(async ({ data }) => {
    const db = await signupDatabase()
    const token = getCookie(SESSION_COOKIE)
    if (!db || !token) return { ok: false as const, message: 'Влез в профила си.' }
    const row = await db
      .prepare(
        `SELECT id, payload, referral_code, referred_by, source, egn, published_section, COALESCE(withdrawn, 0) AS withdrawn,
                COALESCE(staff_called_at, '') AS staff_called_at, COALESCE(staff_called_by, '') AS staff_called_by
         FROM signups WHERE session_token = ?`,
      )
      .bind(token)
      .first<SignupRow & { withdrawn: number; staff_called_at: string; staff_called_by: string }>()
    if (!row) return { ok: false as const, message: 'Влез в профила си.' }
    if (row.withdrawn === 1) return { ok: false as const, message: 'Записването е оттеглено.' }
    const profile = profileFrom(row)
    const section = profile.assignedSection
    if (!section) return { ok: false as const, message: 'Още няма публикувана секция.' }
    const now = new Date().toISOString()
    const next = applyCantReachReport({
      callMessage: profile.callMessage,
      // After a team call this is a new request, so it gets a new timestamp.
      callRequestedAt: row.staff_called_at ? null : profile.callRequestedAt,
      section,
      note: data.note,
      now,
    })
    const saved = normalizeCantReachSection(
      normalizeCallRequest({
        ...profile,
        callMessage: next.callMessage,
        callRequestedAt: next.callRequestedAt,
        cantReachSection: next.cantReachSection,
      }),
    )
    const payload = signupColumns(saved).payload
    await db.prepare(reopenCallQueueSql()).bind(payload, now, row.id, token).run()
    if (row.staff_called_at) {
      const audit = callReopenAudit(row.staff_called_at, row.staff_called_by, saved.callMessage)
      await db
        .prepare(CALL_REOPEN_AUDIT_SQL)
        .bind(crypto.randomUUID(), row.id, saved.email, audit.field, audit.before, audit.after, now)
        .run()
    }
    return {
      ok: true as const,
      callMessage: saved.callMessage,
      callRequestedAt: saved.callRequestedAt,
      cantReachSection: saved.cantReachSection,
    }
  })

/** The ЕГН step's check before „Напред“: signed-in sessions only, and only a yes/no answer. */
export const egnInUse = createServerFn({ method: 'POST' })
  .validator((input: { egn: string }) => ({ egn: egnDigits(String(input?.egn ?? '')).slice(0, 10) }))
  .handler(async ({ data }) => {
    const db = await signupDatabase()
    const cookie = getCookie(SESSION_COOKIE)
    if (!db || !cookie || data.egn.length !== 10) return { taken: false as const }
    const own = await db.prepare('SELECT id, COALESCE(egn, \'\') AS egn FROM signups WHERE session_token = ?').bind(cookie).first<{ id: string; egn: string }>()
    if (!own || !egnNeedsCheck(data.egn, own.egn)) return { taken: false as const }
    return (await egnUsedElsewhere(db, data.egn, own.id)) ? { taken: true as const, message: EGN_IN_USE_MESSAGE } : { taken: false as const }
  })

export const loadSignup = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await signupDatabase()
  const token = getCookie(SESSION_COOKIE)
  if (!db || !token) return null
  // published_section is the only assignment this session may see. draft_section is not selected.
  const row = await db
    .prepare('SELECT id, payload, referral_code, referred_by, source, egn, published_section FROM signups WHERE session_token = ?')
    .bind(token)
    .first<SignupRow>()
  if (!row) return null
  const profile = profileFrom(row)
  profile.companions = await companionsForSignup(db, row.id, profile.companions)
  const countRow = profile.referralCode
    ? await db.prepare('SELECT COUNT(*) AS n FROM signups WHERE referred_by = ?').bind(profile.referralCode).first<{ n: number }>()
    : null
  return {
    profile,
    referrerName: await referrerName(db, profile.referredBy),
    referralCount: countRow?.n ?? 0,
  }
})

/**
 * „Запиши друг човек“: this browser lets go of its record (tb_session) so the next save starts a new
 * one. The record itself is untouched; its owner gets back in with the code on /vhod.
 */
export const leaveSignupSession = createServerFn({ method: 'POST' }).handler(async () => {
  setCookie(SESSION_COOKIE, '', { httpOnly: true, secure: sessionCookieSecure(requestHost()), sameSite: 'lax', path: '/', maxAge: 0 })
  return { ok: true as const }
})

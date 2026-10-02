import { createServerFn } from '@tanstack/react-start'
import { getCookie, getRequestHost, getRequestUrl, setCookie } from '@tanstack/react-start/server'
import { profileFrom, SESSION_COOKIE, signupDatabase, type SignupD1, type SignupRow } from './db-core'
import { signupGap, type Profile } from './model'
import { companionsForSignup, syncCompanions } from './companion-lifecycle'
import { deliverMail, isDevMailHost } from './mail'
import { egnProblem, signupColumns } from './record'
import { receiptClaimed, signupReceiptMail } from './receipt'
import { sessionCookieSecure } from './session-cookie'

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
    const problem = egnProblem(data.egn)
    if (problem) return { ok: false as const, message: problem }
    const now = new Date().toISOString()
    const cookie = getCookie(SESSION_COOKIE)
    const bySession = cookie
      ? await db
          .prepare('SELECT id, email, session_token, imported, email_confirmed FROM signups WHERE session_token = ?')
          .bind(cookie)
          .first<{ id: string; email: string; session_token: string | null; imported: number | null; email_confirmed: number | null }>()
      : null
    if (bySession && bySession.email.trim().toLowerCase() !== data.email.trim().toLowerCase()) {
      data = { ...data, email: bySession.email, emailConfirmed: bySession.email_confirmed === 1 }
    }
    const columns = signupColumns(data)
    const byEmail = await db
      .prepare('SELECT id, session_token, imported, email_confirmed FROM signups WHERE email = ?')
      .bind(columns.email)
      .first<{ id: string; session_token: string | null; imported: number | null; email_confirmed: number | null }>()
    if (bySession && byEmail && byEmail.id !== bySession.id) {
      if (byEmail.imported && !byEmail.email_confirmed) {
        return { ok: false as const, message: 'Този имейл чака потвърждение от писмото.' }
      }
      return { ok: false as const, message: 'Този имейл вече е на друго записване.' }
    }
    if (byEmail?.imported && !byEmail.email_confirmed && cookie !== byEmail.session_token) {
      return { ok: false as const, message: 'Този имейл чака потвърждение от писмото.' }
    }
    const existing = bySession ?? byEmail
    const id = existing?.id ?? crypto.randomUUID()
    const token = existing?.session_token ?? crypto.randomUUID()
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
        columns.withdrawn,
        columns.notes,
        now,
        now,
      )
      .run()
    const synced = await syncCompanions(db, id, data.companions)
    data = { ...data, companions: synced.companions }
    await db.prepare('UPDATE signups SET payload = ? WHERE id = ?').bind(signupColumns(data).payload, id).run()
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
    }
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

/**
 * THE SWITCH for public volunteer signups: SIGNUPS_CLOSE_AT below, the one place to change it.
 * Closed on 24.10.2026, the day before the first round; reopened on 26.10.2026 for the runoff on 1.11.2026;
 * closes again by itself on Saturday 31.10.2026 at 09:00 Sofia, the morning before the runoff.
 * To close now, set SIGNUPS_CLOSE_AT to a past time; to reopen, move it into the future.
 *
 * Evaluated per call, not at import: the worker isolate and an open browser tab both outlive the cutoff,
 * so the UI (signupsClosed() at render) and the server (saveSignup, requestEmailCode) read the clock each time.
 *
 * Closed means no new record: saveSignup refuses a save that would create one (signup-guard „new“), and
 * requestEmailCode sends no code to an address without a record. People who already have a record keep
 * everything: /vhod, /profil, editing on /signup from their own session, the пълномощно, the badge, and
 * their section. Admins still add volunteers by hand (staff-add-volunteer.ts skips this check).
 *
 * VITE_SIGNUPS_OPEN=1 keeps them open only for the e2e dev server (playwright.config.ts), so the signup
 * flow specs keep running after the cutoff. Production builds never set it.
 */
export const SIGNUPS_CLOSE_AT = '2026-10-31T09:00:00+02:00'

const CLOSE_AT = new Date(SIGNUPS_CLOSE_AT)

/** Open only before SIGNUPS_CLOSE_AT. */
export function signupsOpen(now: Date = new Date()) {
  return now < CLOSE_AT
}

export function signupsClosed(now: Date = new Date()) {
  return !signupsOpen(now) && import.meta.env.VITE_SIGNUPS_OPEN !== '1'
}

export const SIGNUPS_CLOSED_MESSAGE = 'Записването на доброволци приключи. Благодарим! Ако вече си записан, влез в профила си.'

/** saveSignup: a save that would create a new record is refused while signups are closed. */
export function refusesNewSignup(decisionKind: 'new' | 'own' | 'refuse', closed: boolean = signupsClosed()) {
  return closed && decisionKind === 'new'
}

/** requestEmailCode without a session: a code goes only to an address that already has a record. */
export function refusesNewCodeRequest(hasRecord: boolean, closed: boolean = signupsClosed()) {
  return closed && !hasRecord
}

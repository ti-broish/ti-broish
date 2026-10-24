/**
 * Volunteer signups closed on 24.10.2026, the day before the election. Set SIGNUPS_CLOSED to false to reopen.
 *
 * Closed means no new record: saveSignup refuses a save that would create one (signup-guard „new“), and
 * requestEmailCode sends no code to an address without a record. People who already have a record keep
 * everything: /vhod, /profil, editing on /signup from their own session, the пълномощно, the badge.
 *
 * VITE_SIGNUPS_OPEN=1 reopens them only for the e2e dev server (playwright.config.ts), so the signup
 * flow specs keep running. Production builds never set it.
 */
export const SIGNUPS_CLOSED: boolean = import.meta.env.VITE_SIGNUPS_OPEN !== '1'

export const SIGNUPS_CLOSED_MESSAGE = 'Записването на доброволци приключи. Благодарим! Ако вече си записан, влез в профила си.'

/** saveSignup: a save that would create a new record is refused while signups are closed. */
export function refusesNewSignup(decisionKind: 'new' | 'own' | 'refuse', closed: boolean = SIGNUPS_CLOSED) {
  return closed && decisionKind === 'new'
}

/** requestEmailCode without a session: a code goes only to an address that already has a record. */
export function refusesNewCodeRequest(hasRecord: boolean, closed: boolean = SIGNUPS_CLOSED) {
  return closed && !hasRecord
}

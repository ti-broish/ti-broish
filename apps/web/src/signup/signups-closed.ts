/**
 * THE SWITCH for public volunteer signups: SIGNUPS_OPEN below. Closed on 24.10.2026, the day before the
 * first round; reopened on 26.10.2026 for the runoff (балотажа). To close again, set SIGNUPS_OPEN = false.
 *
 * Closed means no new record: saveSignup refuses a save that would create one (signup-guard „new“), and
 * requestEmailCode sends no code to an address without a record. People who already have a record keep
 * everything: /vhod, /profil, editing on /signup from their own session, the пълномощно, the badge.
 *
 * VITE_SIGNUPS_OPEN=1 reopens them only for the e2e dev server (playwright.config.ts), so the signup
 * flow specs keep running even while SIGNUPS_OPEN is false. Production builds never set it.
 */
export const SIGNUPS_OPEN: boolean = true

export const SIGNUPS_CLOSED: boolean = !SIGNUPS_OPEN && import.meta.env.VITE_SIGNUPS_OPEN !== '1'

export const SIGNUPS_CLOSED_MESSAGE = 'Записването на доброволци приключи. Благодарим! Ако вече си записан, влез в профила си.'

/** saveSignup: a save that would create a new record is refused while signups are closed. */
export function refusesNewSignup(decisionKind: 'new' | 'own' | 'refuse', closed: boolean = SIGNUPS_CLOSED) {
  return closed && decisionKind === 'new'
}

/** requestEmailCode without a session: a code goes only to an address that already has a record. */
export function refusesNewCodeRequest(hasRecord: boolean, closed: boolean = SIGNUPS_CLOSED) {
  return closed && !hasRecord
}

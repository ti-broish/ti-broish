import { DEFAULT_DESIGNATION_CONFIG, ELECTION_DISTRICTS } from '../designation-config'

/** CIK's code for the 25.10.2026 election, as in https://www.cik.bg/bg/pvr2026/rik. */
export const RIK_ELECTION = 'pvr2026'

/** Canonical list of РИК sites for this election; the sync re-reads it in case a link changes. */
export const CIK_RIK_INDEX_URL = `https://www.cik.bg/bg/${RIK_ELECTION}/rik`

/** МИР 32 (abroad) has no РИК: CIK publishes that register itself. */
export const ABROAD_MIR = '32'
export const CIK_ELECTION_BASE = `https://www.cik.bg/bg/${RIK_ELECTION}`

export const REGISTER_PATHS = {
  representative: 'registers/register_p',
  advocate: 'registers/advocates',
} as const

export type RegisterKind = keyof typeof REGISTER_PATHS

/** How long a signed пълномощно may stay unpublished before the РИК gets a call. */
export const STALE_AFTER_HOURS = 36
/** Each РИК is fetched at most this often; under the hourly cron (:07) that means every run (50 min leaves slack for run jitter). */
export const MIN_INTERVAL_MINUTES = 50
/** Other parties' batch pages change rarely; re-read them at most this often. */
export const OTHER_PARTY_INTERVAL_MINUTES = 360
/** Contacts (phones) are re-read at most once a day. */
export const CONTACTS_INTERVAL_MINUTES = 24 * 60
/** The CIK index of РИК sites is re-read at most this often. */
export const INDEX_INTERVAL_MINUTES = 12 * 60
/** Failed runs in a row before a „провери РИК ръчно“ task appears. */
export const MANUAL_CHECK_AFTER_FAILURES = 2
/** Pause between two requests (all go to *.cik.bg). */
export const FETCH_PAUSE_MS = 400
/** Requests per run; the rest of the РИК wait for the next run. Override with RIK_SYNC_FETCH_BUDGET. */
export const DEFAULT_FETCH_BUDGET = 300
export const USER_AGENT = 'TiBroish-RIK-sync/1.0 (+https://tibroish.bg/kontakt)'

/**
 * Our committee on the registers. CIK and the РИК write it in full or shortened
 * („ИК за издигане на Андрей Гюров…“), so match on the candidates' surnames.
 */
const SURNAMES = (() => {
  const full = DEFAULT_DESIGNATION_CONFIG.committeeFullName
  const names = [...full.matchAll(/(?:на|и) ([А-Я][а-я]+) ([А-Я][а-я]+) ([А-Я][а-я]+) за/g)].map((m) => m[3]!)
  return names.length ? names : ['Гюров', 'Кандев']
})()

export function isOurCommittee(party: string) {
  return SURNAMES.some((surname) => party.toLocaleLowerCase('bg').includes(surname.toLocaleLowerCase('bg')))
}

export function mirLabel(mir: string) {
  if (mir === ABROAD_MIR) return 'Извън страната (ЦИК)'
  return ELECTION_DISTRICTS[mir] ?? mir
}

export const DOMESTIC_MIRS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))

/** Fallback when the CIK index cannot be read: the pattern every РИК used since 2021. */
export function defaultElectionBase(mir: string) {
  return mir === ABROAD_MIR ? CIK_ELECTION_BASE : `https://rik${mir}.cik.bg/${RIK_ELECTION}`
}

export function registerUrl(base: string, kind: RegisterKind) {
  return `${base.replace(/\/+$/, '')}/${REGISTER_PATHS[kind]}`
}

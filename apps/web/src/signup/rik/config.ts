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

/**
 * How long a signed пълномощно may stay unpublished before the РИК gets a call. Counted from the
 * later of the first signed upload and the МИР's rik_sources.submitted_at (when the batch actually
 * went to that РИК).
 */
export const STALE_AFTER_HOURS = 24
/** Production cron cadence for the sync (:07, :22, :37, :52; see src/scheduled-jobs.ts). */
export const RIK_SYNC_INTERVAL_MINUTES = 15
/** Each РИК is fetched at most this often; under the 15-min cron that means every run (10 min leaves slack for run jitter). */
export const MIN_INTERVAL_MINUTES = 10
/** Other parties' batch pages change rarely; re-read them at most this often. */
export const OTHER_PARTY_INTERVAL_MINUTES = 360
/** Contacts (phones) are re-read at most once a day. */
export const CONTACTS_INTERVAL_MINUTES = 24 * 60
/** The CIK index of РИК sites is re-read at most this often. */
export const INDEX_INTERVAL_MINUTES = 12 * 60
/** Failed runs in a row before a „провери РИК ръчно“ task appears. */
export const MANUAL_CHECK_AFTER_FAILURES = 2
/**
 * Failed runs in a row before a РИК turns from „warning“ (one bad hour, the last good data still
 * counts) to „error“ (its people show as „РИК не се чете“).
 */
export const ERROR_AFTER_FAILURES = 2
/** A page that answers 5xx (520/522/524 from CIK's proxy) or fails on the network is retried after these pauses. */
export const RETRY_DELAYS_MS = [1_000, 3_000, 8_000]
/**
 * A cron invocation may run 15 min (wall clock). The sync stops starting new РИК after this long;
 * the rest are read first in the next run (oldest attempt first).
 */
export const RUN_TIME_LIMIT_MS = 11 * 60_000
/** D1 can refuse queries for a while (e.g. „Currently processing a long-running export“); the cron waits and retries. */
export const D1_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 90_000]
/** Pause between two requests (all go to *.cik.bg). */
export const FETCH_PAUSE_MS = 400
/** Requests per run; the rest of the РИК wait for the next run. Override with RIK_SYNC_FETCH_BUDGET. */
export const DEFAULT_FETCH_BUDGET = 300
/** Stable and honest: who we are and how to reach us. Never a browser's User-Agent. */
export const USER_AGENT = 'TiBroishRikSync/1.0 (+https://tibroish.bg; team@tibroish.bg)'
/** Each pause between requests is FETCH_PAUSE_MS × a random factor in [1 − j, 1 + j]. */
export const FETCH_PAUSE_JITTER = 0.25
/** A blocked host (challenge, 403, 429) is left alone this long (or Retry-After, if longer): it skips the next few runs. */
export const BLOCK_BACKOFF_MINUTES = 100
/** Blocked РИК in one run after which the run stops (the block is likely CIK-wide). */
export const MAX_BLOCKED_PER_RUN = 3
/** Retry-After up to this long is waited out in place; longer means „come back later“. */
export const MAX_INLINE_RETRY_AFTER_MS = 10_000
/**
 * „Провери в РИК“ next to one person: a РИК read (by the cron or another click) less than this long
 * ago is not fetched again; the button shows the result already stored.
 */
export const MANUAL_CHECK_THROTTLE_SECONDS = 60
/** Request budget of one „Провери в РИК“ (one представители register with its batch pages). */
export const MANUAL_CHECK_BUDGET = 40
/** When a register's list page is unchanged, our batch pages are re-read at most this often (about every two hours). */
export const UNCHANGED_LIST_BATCH_INTERVAL_MINUTES = 110

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

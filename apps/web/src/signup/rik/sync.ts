/**
 * The РИК sync: reads the CIK index of РИК sites, each РИК's представители (and застъпници)
 * register for this election, stores what changed, then re-derives statuses and tasks.
 * Runs from the Worker cron (src/server.ts) and from the admin „Синхронизирай“ button.
 *
 * Polite and resilient: one request at a time with a pause, a request budget and a time limit per
 * run, each РИК at most every MIN_INTERVAL_MINUTES, unchanged pages (same SHA-256) cost no writes,
 * a 5xx/network failure is retried with backoff (RETRY_DELAYS_MS), and a failing РИК is recorded
 * and skipped without stopping the others. A РИК that fails keeps its last good data: it goes to
 * „warning“ on the first failed run and to „error“ only after ERROR_AFTER_FAILURES in a row.
 * Every run has a rik_runs row from its start (status running → ok | partial | failed). Idempotent: entries are keyed by
 * МИР + register + party + name + number, so re-reading a page, a page split into batches or a
 * batch merged into another never duplicates a row.
 *
 * It never writes signups, partner_people, sections or drafts, never removes anyone and never
 * mails: it only fills the rik_* tables, and reserves external numbers in designation_numbers
 * (externals.ts).
 */
import { partnerDuplicateSql, signupDuplicateSql } from '../designation-duplicates'
import { DESIGNATION_NUMBERS_TABLE } from '../designation-numbers'
import type { SignupD1 } from '../db-core'
import { loadRikCorrections } from '../designation-rename'
import {
  ABROAD_MIR,
  CIK_RIK_INDEX_URL,
  CONTACTS_INTERVAL_MINUTES,
  DEFAULT_FETCH_BUDGET,
  DOMESTIC_MIRS,
  BLOCK_BACKOFF_MINUTES,
  ERROR_AFTER_FAILURES,
  FETCH_PAUSE_JITTER,
  FETCH_PAUSE_MS,
  INDEX_INTERVAL_MINUTES,
  MANUAL_CHECK_AFTER_FAILURES,
  MAX_BLOCKED_PER_RUN,
  MAX_INLINE_RETRY_AFTER_MS,
  MIN_INTERVAL_MINUTES,
  OTHER_PARTY_INTERVAL_MINUTES,
  RETRY_DELAYS_MS,
  RIK_ELECTION,
  RUN_TIME_LIMIT_MS,
  UNCHANGED_LIST_BATCH_INTERVAL_MINUTES,
  USER_AGENT,
  defaultElectionBase,
  isOurCommittee,
  mirLabel,
  registerUrl,
  type RegisterKind,
} from './config'
import { BlockedBySite, detectBlock, hostOf, mayBeBlockPage, parseRetryAfter } from './block'
import { externalNumberStatements, findExternalNumbers, LEDGER_OURS_SQL, UNNUMBERED_PEOPLE_SQL, type UnnumberedPerson } from './externals'
import { buildIndex, matchAll, nameParts, type DerivedTask, type PersonResult, type RikEntryRow, type RikPerson, type RikSourceHealth } from './match'
import { isAnnulledName, joinNames, nameKey, parseNumberWithDate, sha256Hex } from './normalize'
import { electionBaseOf, parseContacts, parseRegisterBatch, parseRegisterList, parseRikIndex } from './parse'
import { RIK_COLUMNS, RIK_INDEXES, RIK_TABLES } from './sql'

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface SyncOptions {
  trigger: 'cron' | 'manual'
  now?: () => Date
  fetcher?: Fetcher
  /** Only these МИР (manual button). */
  mirs?: string[]
  /** Ignore MIN_INTERVAL_MINUTES and the page intervals. */
  force?: boolean
  budget?: number
  pauseMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Random source for the pause jitter (tests). */
  random?: () => number
  /** Pauses before each retry of a 5xx/network failure; [] turns retries off. */
  retryDelaysMs?: number[]
  /** Stop starting new РИК after this long (ms); the rest go first next run. */
  timeLimitMs?: number
  /** A rik_runs row already started by the caller (the cron writes it before anything else). */
  runId?: string
}

export interface SyncSummary {
  runId: string
  fetched: number
  changed: number
  errors: number
  synced: string[]
  skipped: string[]
  budgetLeft: number
  retries: number
  blocked: string[]
  status: RikRunStatus
  statuses: Record<string, number>
  tasks: Record<string, number>
  /** Numbers in our committee's registers that none of our people hold („външни“). */
  externals?: number
}

const ensured = new WeakSet<object>()

export async function ensureRikTables(db: SignupD1) {
  if (ensured.has(db)) return
  for (const sql of RIK_TABLES) await db.prepare(sql).run()
  for (const sql of RIK_INDEXES) await db.prepare(sql).run()
  // The number ledger (bootstrap makes it with its triggers); the sync adds external numbers to it.
  await db.prepare(DESIGNATION_NUMBERS_TABLE).run()
  const columns = new Map<string, Set<string>>()
  for (const [table, column, definition] of RIK_COLUMNS) {
    if (!columns.has(table)) {
      const info = (await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results ?? []
      columns.set(table, new Set(info.map((row) => String(row.name))))
    }
    if (columns.get(table)!.has(column)) continue
    try {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run()
    } catch (error) {
      if (!/duplicate column/i.test(error instanceof Error ? error.message : String(error))) throw error
    }
    columns.get(table)!.add(column)
  }
  ensured.add(db)
}

export type RikRunStatus = 'running' | 'ok' | 'partial' | 'failed' | 'missed'

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300)
}

/** Writes the run row first, so a run that dies later still leaves a trace. */
export async function startRikRun(db: SignupD1, trigger: SyncOptions['trigger'], at: Date, runId: string = crypto.randomUUID()) {
  await ensureRikTables(db)
  await db.prepare(`INSERT OR IGNORE INTO rik_runs (id, trigger, started_at, status) VALUES (?, ?, ?, 'running')`).bind(runId, trigger, at.toISOString()).run()
  return runId
}

/** Marks a run that threw as failed, with the error, keeping whatever counts it had. */
export async function failRikRun(db: SignupD1, runId: string, at: Date, error: unknown, counts: { fetched?: number; changed?: number; errors?: number } = {}) {
  await db
    .prepare(
      `UPDATE rik_runs SET finished_at = ?, status = 'failed', fetched = MAX(fetched, ?), changed = MAX(changed, ?), errors = MAX(errors, ?), note = ? WHERE id = ?`,
    )
    .bind(at.toISOString(), counts.fetched ?? 0, counts.changed ?? 0, counts.errors ?? 0, `Грешка: ${errorText(error)}`, runId)
    .run()
}

/** 5xx (incl. Cloudflare's 520/522/524 in front of CIK) is worth another try; 4xx is an answer. */
export function isRetryableStatus(status: number) {
  return status >= 500 && status <= 599
}

class BudgetSpent extends Error {}

/** A 5xx with a long Retry-After: the host asked us to come back later. */
class RetryLater extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message)
  }
}

interface Page {
  status: number
  body: string
  hash: string
  etag: string
  lastModified: string
}

interface Validators {
  content_hash: string
  etag: string | null
  last_modified: string | null
}

const ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
const ACCEPT_LANGUAGE = 'bg,en;q=0.5'

function minutesSince(iso: string | null | undefined, now: Date) {
  if (!iso) return Infinity
  const at = Date.parse(iso)
  return Number.isFinite(at) ? (now.getTime() - at) / 60_000 : Infinity
}

async function chunked(db: SignupD1, statements: ReturnType<SignupD1['prepare']>[]) {
  for (let i = 0; i < statements.length; i += 50) {
    const part = statements.slice(i, i + 50)
    if (part.length) await db.batch(part)
  }
}

export async function entryId(parts: { kind: string; mir: string; ours: boolean; party: string; nameKey: string; numberRaw: string }) {
  const number = parseNumberWithDate(parts.numberRaw)
  const numberKey = number.number != null ? `${number.prefix}${number.number}/${number.date ?? ''}` : parts.numberRaw.replace(/\s+/g, '')
  const owner = parts.ours ? 'ours' : nameKey(parts.party)
  return (await sha256Hex(`${parts.kind}|${parts.mir}|${owner}|${parts.nameKey}|${numberKey}`)).slice(0, 32)
}

/**
 * Everyone who holds a пълномощно number: signups (incl. mobile teams) and „И аз“ partner people.
 * A withdrawn „И аз“ row reads as withdrawn; a duplicate (same ЕГН keeps another number) is flagged
 * so it never gets a „call the РИК“ task.
 */
export const RIK_PEOPLE_SQL = `
SELECT id, 'signup' AS source, COALESCE(designation_mir, '') AS mir, designation_number AS number,
       COALESCE(designation_issued_at, '') AS issued_on,
       COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
       COALESCE(json_extract(payload, '$.middleName'), '') AS middle_name,
       COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
       COALESCE(withdrawn, 0) AS withdrawn,
       COALESCE(designation_first_signed_at, designation_signed_at) AS signed_at,
       CASE WHEN COALESCE(withdrawn, 0) = 0 AND ${signupDuplicateSql('signups')} THEN 1 ELSE 0 END AS duplicate
FROM signups WHERE designation_number IS NOT NULL AND COALESCE(designation_mir, '') != ''
UNION ALL
SELECT id, 'partner' AS source, COALESCE(designation_mir, '') AS mir, designation_number AS number,
       COALESCE(designation_issued_at, '') AS issued_on, first_name, middle_name, last_name,
       CASE WHEN withdrawn_at IS NOT NULL THEN 1 ELSE 0 END AS withdrawn,
       COALESCE(designation_first_signed_at, designation_signed_at) AS signed_at,
       CASE WHEN withdrawn_at IS NULL AND ${partnerDuplicateSql('partner_people')} THEN 1 ELSE 0 END AS duplicate
FROM partner_people WHERE designation_number IS NOT NULL AND COALESCE(designation_mir, '') != ''`

interface PersonRow {
  id: string
  source: 'signup' | 'partner'
  mir: string
  number: number | null
  issued_on: string
  first_name: string
  middle_name: string
  last_name: string
  withdrawn: number
  signed_at: string | null
  duplicate?: number | null
}

export async function loadPeople(db: SignupD1): Promise<RikPerson[]> {
  const rows = (await db.prepare(RIK_PEOPLE_SQL).all<PersonRow>()).results ?? []
  const corrections = await loadRikCorrections(db)
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    mir: String(row.mir).padStart(2, '0'),
    number: row.number == null ? null : Number(row.number),
    issuedOn: (row.issued_on ?? '').trim(),
    nameKey: nameKey(joinNames(row.first_name ?? '', row.middle_name ?? '', row.last_name ?? '')),
    nameParts: nameParts(joinNames(row.first_name ?? '', row.middle_name ?? '', row.last_name ?? '')),
    withdrawn: Number(row.withdrawn) === 1,
    signedAt: row.signed_at || null,
    duplicate: Number(row.duplicate ?? 0) === 1,
    ...(corrections.get(row.id)?.oldNames.length ? { previousNames: corrections.get(row.id)!.oldNames } : {}),
  }))
}

/** The ledger as the matcher needs it: our numbers and the МИР each person ever held a number in. */
export async function loadLedger(db: SignupD1) {
  const rows = (await db.prepare(LEDGER_OURS_SQL).all<{ mir: string; number: number; person_id: string | null }>()).results ?? []
  const ours = new Set<string>()
  const mirs = new Map<string, Set<string>>()
  for (const row of rows) {
    ours.add(`${row.mir}:${Number(row.number)}`)
    if (row.person_id) mirs.set(row.person_id, (mirs.get(row.person_id) ?? new Set()).add(row.mir))
  }
  return { ours, mirs }
}

export async function loadUnnumbered(db: SignupD1): Promise<UnnumberedPerson[]> {
  const rows = (await db.prepare(UNNUMBERED_PEOPLE_SQL).all<{ id: string; first_name: string; middle_name: string; last_name: string }>()).results ?? []
  return rows.map((row) => ({ id: row.id, nameKey: nameKey(joinNames(row.first_name ?? '', row.middle_name ?? '', row.last_name ?? '')) })).filter((row) => row.nameKey)
}

interface SourceRow {
  mir: string
  name: string
  base_url: string
  contacts_url: string
  contacts_at: string | null
  health: string
  last_attempt_at: string | null
  failures: number
  last_error: string
  last_good_health?: string | null
  blocked_until?: string | null
}

export function createRikSync(db: SignupD1, options: SyncOptions) {
  const now = options.now ?? (() => new Date())
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  const pause = options.pauseMs ?? FETCH_PAUSE_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const retryDelays = options.retryDelaysMs ?? RETRY_DELAYS_MS
  let budget = options.budget ?? DEFAULT_FETCH_BUDGET
  let fetched = 0
  let changed = 0
  let requests = 0
  let retries = 0
  const blocked: string[] = []

  /** Hosts that answered with a challenge/403/429 in this run: nothing more is asked of them. */
  const blockedHosts = new Map<string, import('./block').BlockInfo>()
  const random = options.random ?? Math.random

  function jittered(ms: number) {
    return Math.round(ms * (1 - FETCH_PAUSE_JITTER + 2 * FETCH_PAUSE_JITTER * random()))
  }

  /**
   * One page, one request at a time (all hosts share one queue, so never more than one request in
   * flight). A 5xx or a network error is retried after each of retryDelays (or the server's short
   * Retry-After); each try costs budget. A challenge/403/429 page throws BlockedBySite and is never
   * parsed. With validators from an earlier read the request is conditional (304 → unchanged).
   */
  async function get(url: string, validators?: Validators | null): Promise<Page> {
    const host = hostOf(url)
    const hostBlock = blockedHosts.get(host)
    if (hostBlock) throw new BlockedBySite(url, hostBlock)
    for (let attempt = 0; ; attempt += 1) {
      if (budget <= 0) throw new BudgetSpent('budget')
      if (requests > 0 && pause > 0) await sleep(jittered(pause))
      budget -= 1
      requests += 1
      const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: ACCEPT, 'accept-language': ACCEPT_LANGUAGE }
      if (validators?.etag) headers['if-none-match'] = validators.etag
      if (validators?.last_modified) headers['if-modified-since'] = validators.last_modified
      let response: Response
      try {
        response = await fetcher(url, { headers, redirect: 'follow' })
      } catch (error) {
        const subrequestLimit = /too many subrequests/i.test(errorText(error))
        if (!subrequestLimit && attempt < retryDelays.length) {
          retries += 1
          await sleep(retryDelays[attempt]!)
          continue
        }
        fetched += 1
        throw error
      }
      const status = response.status
      const body = mayBeBlockPage(status) ? await response.text() : ''
      if (!mayBeBlockPage(status)) await response.body?.cancel().catch(() => {})
      const block = detectBlock({ status, headers: response.headers, body }, now())
      if (block) {
        fetched += 1
        blockedHosts.set(host, block)
        throw new BlockedBySite(url, block)
      }
      if (isRetryableStatus(status) && attempt < retryDelays.length) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'), now())
        if (retryAfter != null && retryAfter > MAX_INLINE_RETRY_AFTER_MS) {
          fetched += 1
          throw new RetryLater(`HTTP ${status} за ${url} (Retry-After ${Math.round(retryAfter / 1000)} s)`, retryAfter)
        }
        retries += 1
        await sleep(retryAfter ?? retryDelays[attempt]!)
        continue
      }
      fetched += 1
      if (status === 304 && validators) return { status, body: '', hash: validators.content_hash, etag: validators.etag ?? '', lastModified: validators.last_modified ?? '' }
      const text = status === 200 ? body : ''
      return {
        status,
        body: text,
        hash: text ? await sha256Hex(text) : '',
        etag: response.headers.get('etag') ?? '',
        lastModified: response.headers.get('last-modified') ?? '',
      }
    }
  }

  async function previousPage(url: string) {
    return db
      .prepare('SELECT content_hash, fetched_at, rows, etag, last_modified FROM rik_pages WHERE url = ?')
      .bind(url)
      .first<{ content_hash: string; fetched_at: string; rows: number; etag: string | null; last_modified: string | null }>()
  }

  async function savePage(url: string, mir: string, kind: string, party: string, ours: boolean, page: Page, rows: number, stamp: string) {
    const before = await previousPage(url)
    const isChange = !before || before.content_hash !== page.hash
    if (isChange) changed += 1
    await db
      .prepare(
        `INSERT INTO rik_pages (url, mir, kind, party, ours, content_hash, http_status, rows, fetched_at, changed_at, etag, last_modified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET party = excluded.party, ours = excluded.ours, content_hash = excluded.content_hash,
           http_status = excluded.http_status, rows = excluded.rows, fetched_at = excluded.fetched_at,
           etag = excluded.etag, last_modified = excluded.last_modified,
           changed_at = CASE WHEN rik_pages.content_hash = excluded.content_hash THEN rik_pages.changed_at ELSE excluded.changed_at END`,
      )
      .bind(url, mir, kind, party, ours ? 1 : 0, page.hash, page.status, rows, stamp, stamp, page.etag, page.lastModified)
      .run()
    return isChange
  }

  async function refreshIndex(stamp: string) {
    const last = await db.prepare(`SELECT fetched_at FROM rik_pages WHERE url = ?`).bind(CIK_RIK_INDEX_URL).first<{ fetched_at: string }>()
    const known = await db.prepare('SELECT COUNT(*) AS n FROM rik_sources').first<{ n: number }>()
    if (!options.force && Number(known?.n ?? 0) >= 32 && minutesSince(last?.fetched_at, now()) < INDEX_INTERVAL_MINUTES) return
    let entries: ReturnType<typeof parseRikIndex> = []
    try {
      const page = await get(CIK_RIK_INDEX_URL)
      if (page.status === 200) {
        entries = parseRikIndex(page.body, CIK_RIK_INDEX_URL)
        await savePage(CIK_RIK_INDEX_URL, '', 'index', '', false, page, entries.length, stamp)
      }
    } catch (error) {
      if (error instanceof BudgetSpent) throw error
    }
    const byMir = new Map(entries.map((entry) => [entry.mir, entry]))
    const statements = [...DOMESTIC_MIRS, ABROAD_MIR].map((mir) => {
      const entry = byMir.get(mir)
      const base = entry ? electionBaseOf(entry, RIK_ELECTION) : defaultElectionBase(mir)
      const contacts = entry?.contactsUrl || (mir === ABROAD_MIR ? '' : `${base}/contacts`)
      return db
        .prepare(
          `INSERT INTO rik_sources (mir, name, base_url, contacts_url, adapter, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(mir) DO UPDATE SET
             name = CASE WHEN excluded.name != '' THEN excluded.name ELSE rik_sources.name END,
             base_url = CASE WHEN ? = 1 OR rik_sources.base_url = '' THEN excluded.base_url ELSE rik_sources.base_url END,
             contacts_url = CASE WHEN ? = 1 OR rik_sources.contacts_url = '' THEN excluded.contacts_url ELSE rik_sources.contacts_url END,
             adapter = excluded.adapter, updated_at = excluded.updated_at`,
        )
        .bind(
          mir,
          entry?.name || mirLabel(mir),
          base,
          contacts,
          mir === ABROAD_MIR ? 'cik-platform/cik' : 'cik-platform/rik',
          stamp,
          entry ? 1 : 0,
          entry ? 1 : 0,
        )
    })
    await chunked(db, statements)
  }

  /** Reads one register of one РИК. Returns the rows to keep and page counts. */
  async function readRegister(mir: string, base: string, kind: RegisterKind, stamp: string, published = false) {
    const listUrl = registerUrl(base, kind)
    const list = await get(listUrl)
    // A register we already read does not vanish: a 404 then is a broken site, not „not published“
    // (treating it as unpublished would mark every entry missing).
    if (list.status === 404 && published) throw new Error(`HTTP 404 за ${listUrl} (регистърът се четеше преди)`)
    if (list.status === 404) return { state: 'not_published' as const, pages: 1, batches: 0, rows: [], unchangedSources: [] as string[] }
    if (list.status !== 200) throw new Error(`HTTP ${list.status} за ${listUrl}`)
    const parsed = parseRegisterList(list.body, listUrl)
    const listChanged = await savePage(listUrl, mir, `${kind}-list`, '', false, list, parsed.batches.length, stamp)
    if (parsed.unrecognised) return { state: 'unrecognised' as const, pages: 1, batches: 0, rows: [], unchangedSources: [] }
    const batchUrls = new Map<string, { party: string; ours: boolean }>()
    for (const batch of parsed.batches) batchUrls.set(batch.url, { party: batch.party, ours: isOurCommittee(batch.party) })
    // A paginated list: follow its pages too.
    const seenList = new Set([listUrl])
    const queue = [...parsed.pages]
    while (queue.length) {
      const next = queue.shift()!
      if (seenList.has(next)) continue
      seenList.add(next)
      const page = await get(next)
      // A list page we could not read means the register was not read in full: fail the РИК
      // (keeping its last good data) instead of marking the rows on that page missing.
      if (page.status !== 200) throw new Error(`HTTP ${page.status} за ${next}`)
      const more = parseRegisterList(page.body, next)
      for (const batch of more.batches) batchUrls.set(batch.url, { party: batch.party, ours: isOurCommittee(batch.party) })
      for (const link of more.pages) if (!seenList.has(link)) queue.push(link)
    }
    const rows: Array<{ party: string; ours: boolean; url: string; name: string; number: string }> = []
    const unchangedSources: string[] = []
    let pages = seenList.size
    for (const [url, meta] of batchUrls) {
      // Another party's batch (named on the list) is not read: only our registers are matched.
      if (!meta.ours && meta.party) continue
      const before = await previousPage(url)
      if (!options.force && before) {
        // Unnamed batches (party only on the batch page): every 6 h. Ours: every run, but when the list page is unchanged, every second run.
        const interval = !meta.ours ? OTHER_PARTY_INTERVAL_MINUTES : listChanged ? 0 : UNCHANGED_LIST_BATCH_INTERVAL_MINUTES
        if (interval > 0 && minutesSince(before.fetched_at, now()) < interval) {
          unchangedSources.push(url)
          continue
        }
      }
      const seenBatch = new Set<string>()
      const batchQueue = [url]
      while (batchQueue.length) {
        const pageUrl = batchQueue.shift()!
        if (seenBatch.has(pageUrl)) continue
        seenBatch.add(pageUrl)
        const page = await get(pageUrl, pageUrl === url && before?.content_hash ? before : null)
        pages += 1
        if (page.status === 304) {
          // Not modified (only when the server sends ETag/Last-Modified): keep the rows we have.
          await db.prepare('UPDATE rik_pages SET fetched_at = ? WHERE url = ?').bind(stamp, pageUrl).run()
          unchangedSources.push(url)
          break
        }
        if (page.status !== 200) throw new Error(`HTTP ${page.status} за ${pageUrl}`)
        const batch = parseRegisterBatch(page.body, pageUrl)
        const party = meta.party || batch.party
        const ours = meta.ours || isOurCommittee(batch.party)
        await savePage(pageUrl, mir, `${kind}-batch`, party, ours, page, batch.rows.length, stamp)
        if (ours) for (const row of batch.rows) rows.push({ party, ours, url, name: row.name, number: row.number })
        for (const link of batch.pages) if (!seenBatch.has(link)) batchQueue.push(link)
      }
    }
    const state = parsed.empty && rows.length === 0 ? ('empty' as const) : ('ok' as const)
    return { state, pages, batches: batchUrls.size, rows, unchangedSources }
  }

  async function saveEntries(mir: string, kind: RegisterKind, rows: Awaited<ReturnType<typeof readRegister>>['rows'], unchangedSources: string[], stamp: string) {
    const ids = new Set<string>()
    const statements: ReturnType<SignupD1['prepare']>[] = []
    for (const row of rows) {
      const key = nameKey(row.name)
      const id = await entryId({ kind, mir, ours: row.ours, party: row.party, nameKey: key, numberRaw: row.number })
      if (ids.has(id)) continue
      ids.add(id)
      const number = parseNumberWithDate(row.number)
      statements.push(
        db
          .prepare(
            `INSERT INTO rik_entries (id, mir, kind, ours, party, source_url, name, name_key, number_raw, number, number_date, annulled, first_seen_at, last_seen_at, missing_since)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(id) DO UPDATE SET source_url = excluded.source_url, party = excluded.party, name = excluded.name,
               last_seen_at = excluded.last_seen_at, missing_since = NULL`,
          )
          .bind(id, mir, kind === 'representative' ? 'representative' : 'advocate', row.ours ? 1 : 0, row.party, row.url, row.name, key, row.number, number.number, number.date, isAnnulledName(row.name) ? 1 : 0, stamp, stamp),
      )
    }
    for (const url of unchangedSources) {
      statements.push(db.prepare('UPDATE rik_entries SET last_seen_at = ? WHERE source_url = ? AND missing_since IS NULL').bind(stamp, url))
    }
    // Rows gone from a register that was read in full: kept, marked missing (a merge moves rows, it does not delete people).
    statements.push(
      db
        .prepare(`UPDATE rik_entries SET missing_since = ? WHERE mir = ? AND kind = ? AND last_seen_at < ? AND missing_since IS NULL`)
        .bind(stamp, mir, kind === 'representative' ? 'representative' : 'advocate', stamp),
    )
    await chunked(db, statements)
    return ids.size
  }

  async function readContacts(source: SourceRow, stamp: string) {
    if (!source.contacts_url) return
    if (!options.force && minutesSince(source.contacts_at, now()) < CONTACTS_INTERVAL_MINUTES) return
    const page = await get(source.contacts_url)
    if (page.status !== 200) return
    const contacts = parseContacts(page.body)
    await db
      .prepare('UPDATE rik_sources SET phones = ?, email = ?, contacts_at = ? WHERE mir = ?')
      .bind(contacts.phones.join(', '), contacts.email, stamp, source.mir)
      .run()
  }

  async function syncOne(source: SourceRow) {
    const stamp = now().toISOString()
    await db.prepare('UPDATE rik_sources SET last_attempt_at = ? WHERE mir = ?').bind(stamp, source.mir).run()
    const base = source.base_url || defaultElectionBase(source.mir)
    const changedBefore = changed
    try {
      const published = source.last_good_health === 'ok' || source.last_good_health === 'empty'
      const reps = await readRegister(source.mir, base, 'representative', stamp, published)
      if (reps.state !== 'unrecognised') await saveEntries(source.mir, 'representative', reps.rows, reps.unchangedSources, stamp)
      let advPages = 0
      if (source.mir !== ABROAD_MIR && reps.state !== 'unrecognised') {
        try {
          const adv = await readRegister(source.mir, base, 'advocate', stamp)
          advPages = adv.pages
          if (adv.state !== 'unrecognised') await saveEntries(source.mir, 'advocate', adv.rows, adv.unchangedSources, stamp)
        } catch (error) {
          if (error instanceof BudgetSpent || error instanceof BlockedBySite) throw error
          // Застъпници are secondary; a broken advocates page must not fail the РИК.
        }
      }
      try {
        await readContacts(source, stamp)
      } catch (error) {
        if (error instanceof BudgetSpent || error instanceof BlockedBySite) throw error
      }
      const ourEntries = reps.rows.filter((row) => row.ours).length
      const otherMatches = reps.rows.filter((row) => !row.ours).length
      const health = reps.state
      await db
        .prepare(
          `UPDATE rik_sources SET health = ?, last_success_at = CASE WHEN ? = 'unrecognised' THEN last_success_at ELSE ? END,
             last_change_at = CASE WHEN ? > 0 THEN ? ELSE last_change_at END,
             last_error = ?, failures = CASE WHEN ? = 'unrecognised' THEN failures + 1 ELSE 0 END,
             last_good_health = CASE WHEN ? = 'unrecognised' THEN last_good_health ELSE ? END, blocked_until = NULL,
             pages = ?, batches = ?, our_entries = ?, other_matches = ?, updated_at = ? WHERE mir = ?`,
        )
        .bind(
          health,
          health,
          stamp,
          changed - changedBefore,
          stamp,
          health === 'unrecognised' ? 'Страницата не прилича на регистър (сменен адрес или оформление).' : '',
          health,
          health,
          health,
          reps.pages + advPages,
          reps.batches,
          ourEntries,
          otherMatches,
          stamp,
          source.mir,
        )
        .run()
      return true
    } catch (error) {
      if (error instanceof BudgetSpent) {
        await db.prepare('UPDATE rik_sources SET last_attempt_at = ? WHERE mir = ?').bind(source.last_attempt_at, source.mir).run()
        throw error
      }
      if (error instanceof BlockedBySite) {
        // Not a failure of the register: nothing is parsed, failures and data stay, people and tasks
        // of this РИК are frozen (rematch), and the host is left alone for a while.
        const wait = Math.max(error.info.retryAfterMs ?? 0, BLOCK_BACKOFF_MINUTES * 60_000)
        await db
          .prepare(`UPDATE rik_sources SET health = 'blocked', last_error = ?, blocked_until = ?, updated_at = ? WHERE mir = ?`)
          .bind(errorText(error), new Date(now().getTime() + wait).toISOString(), stamp, source.mir)
          .run()
        blocked.push(source.mir)
        return false
      }
      const message = errorText(error)
      const backoff = error instanceof RetryLater ? new Date(now().getTime() + error.retryAfterMs).toISOString() : null
      // Entries, pages and last_success_at are left as they were: the last good read keeps counting.
      // First failed run → warning; ERROR_AFTER_FAILURES in a row → error.
      await db
        .prepare(
          `UPDATE rik_sources SET health = CASE WHEN failures + 1 >= ? THEN 'error' ELSE 'warning' END,
             last_error = ?, failures = failures + 1, blocked_until = ?, updated_at = ? WHERE mir = ?`,
        )
        .bind(ERROR_AFTER_FAILURES, message, backoff, stamp, source.mir)
        .run()
      // Too many subrequests: stop this run, the next one carries on.
      if (/too many subrequests/i.test(message)) throw new BudgetSpent(message)
      return false
    }
  }

  async function rematch() {
    const stamp = now().toISOString()
    const people = await loadPeople(db)
    // Our committee's rows only: other parties' registers are not matched (old rows stay, unused).
    const entries = ((await db.prepare(`SELECT id, mir, kind, ours, party, name, name_key, number, number_date, annulled, missing_since, source_url FROM rik_entries WHERE ours = 1 ORDER BY first_seen_at, id`).all<{
      id: string
      mir: string
      kind: 'representative' | 'advocate'
      ours: number
      party: string
      name: string
      name_key: string
      number: number | null
      number_date: string | null
      annulled: number
      missing_since: string | null
      source_url: string
    }>()).results ?? []).map(
      (row): RikEntryRow => ({
        id: row.id,
        mir: row.mir,
        kind: row.kind,
        ours: Number(row.ours) === 1,
        party: row.party,
        name: row.name,
        nameKey: row.name_key,
        number: row.number == null ? null : Number(row.number),
        numberDate: row.number_date,
        annulled: Number(row.annulled) === 1,
        missingSince: row.missing_since,
        sourceUrl: row.source_url,
      }),
    )
    const sources = ((await db
      .prepare('SELECT mir, health, failures, last_error, last_good_health, submitted_at FROM rik_sources')
      .all<{ mir: string; health: RikSourceHealth['health']; failures: number; last_error: string; last_good_health: string | null; submitted_at: string | null }>()).results ?? []).map(
      (row): RikSourceHealth => ({
        mir: row.mir,
        health: row.health,
        failures: Number(row.failures),
        lastError: row.last_error,
        lastGoodHealth: row.last_good_health ?? '',
        submittedAt: row.submitted_at || null,
      }),
    )
    // A РИК blocked by the site is frozen: its people keep their status and tasks as they were.
    const frozen = new Set(sources.filter((source) => source.health === 'blocked').map((source) => source.mir))
    const ledger = await loadLedger(db)
    const { results, tasks } = matchAll(
      people.filter((person) => !frozen.has(person.mir)),
      entries,
      sources,
      now(),
      MANUAL_CHECK_AFTER_FAILURES,
      { ledgerMirs: ledger.mirs, everyone: people },
    )
    // External numbers into the ledger first, so the next number skips them from this run on.
    const external = findExternalNumbers(entries, buildIndex(entries, people, ledger.mirs), ledger.ours, await loadUnnumbered(db))
    await chunked(db, externalNumberStatements(db, external.numbers, stamp, external.reclaimed, external.cleared))
    await writeResults(db, results, [...tasks, ...external.tasks].filter((one) => !frozen.has(one.mir)), stamp, [...frozen])
    const statuses: Record<string, number> = {}
    for (const row of (await db.prepare('SELECT status, COUNT(*) AS n FROM rik_status GROUP BY status').all<{ status: string; n: number }>()).results ?? []) {
      statuses[row.status] = Number(row.n)
    }
    const taskCounts: Record<string, number> = {}
    for (const row of (await db.prepare('SELECT type, COUNT(*) AS n FROM rik_tasks WHERE active = 1 GROUP BY type').all<{ type: string; n: number }>()).results ?? []) {
      taskCounts[row.type] = Number(row.n)
    }
    return { statuses, tasks: taskCounts, externals: external.numbers.length }
  }

  async function run(): Promise<SyncSummary> {
    const startedAt = now()
    const started = startedAt.toISOString()
    const runId = options.runId ?? (await startRikRun(db, options.trigger, startedAt))
    await ensureRikTables(db)
    const timeLimit = options.timeLimitMs ?? RUN_TIME_LIMIT_MS
    const synced: string[] = []
    const skipped: string[] = []
    let errors = 0
    let note = ''
    try {
      try {
        await refreshIndex(started)
        const sources = (await db.prepare('SELECT mir, name, base_url, contacts_url, contacts_at, health, last_attempt_at, failures, last_error, last_good_health, blocked_until FROM rik_sources ORDER BY COALESCE(last_attempt_at, \'\') ASC, mir ASC').all<SourceRow>()).results ?? []
        for (const source of sources) {
          if (options.mirs?.length && !options.mirs.includes(source.mir)) continue
          if (!options.force && minutesSince(source.last_attempt_at, now()) < MIN_INTERVAL_MINUTES) {
            skipped.push(source.mir)
            continue
          }
          if (!options.force && source.blocked_until && Date.parse(source.blocked_until) > now().getTime()) {
            // The site blocked us or asked us to come back later: leave this host alone until then.
            skipped.push(source.mir)
            continue
          }
          if (blocked.length >= MAX_BLOCKED_PER_RUN) {
            note = `Сайтът блокира ${blocked.length} РИК подред; спряхме това пускане, за да не натоварваме.`
            skipped.push(source.mir)
            continue
          }
          if (now().getTime() - startedAt.getTime() >= timeLimit) {
            // Out of time for this invocation: these РИК have the oldest attempt, so they go first next run.
            note = 'Времето за това пускане свърши; останалите РИК са първи в следващото.'
            skipped.push(source.mir)
            continue
          }
          const ok = await syncOne(source)
          if (ok) synced.push(source.mir)
          else errors += 1
        }
      } catch (error) {
        if (!(error instanceof BudgetSpent)) throw error
        note = 'Лимитът заявки за това пускане свърши; останалите РИК са в следващото.'
      }
      const counts = await rematch()
      const status: RikRunStatus = errors > 0 || note ? 'partial' : 'ok'
      await db
        .prepare('UPDATE rik_runs SET finished_at = ?, fetched = ?, changed = ?, errors = ?, note = ?, status = ? WHERE id = ?')
        .bind(now().toISOString(), fetched, changed, errors, note || JSON.stringify({ ...counts, retries, blocked }), status, runId)
        .run()
      return { runId, fetched, changed, errors, synced, skipped, budgetLeft: budget, retries, blocked, status, ...counts }
    } catch (error) {
      await failRikRun(db, runId, now(), error, { fetched, changed, errors }).catch(() => {})
      throw error
    }
  }

  return { run, rematch }
}

/** Upserts statuses and tasks. A task whose cause is gone becomes inactive; done/undo stays. */
export async function writeResults(db: SignupD1, results: PersonResult[], tasks: DerivedTask[], stamp: string, frozenMirs: string[] = []) {
  const statements: ReturnType<SignupD1['prepare']>[] = []
  for (const result of results) {
    statements.push(
      db
        .prepare(
          `INSERT INTO rik_status (person_id, source, mir, number, status, entry_id, other_mir, other_party, detail, status_since, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(person_id) DO UPDATE SET source = excluded.source, mir = excluded.mir, number = excluded.number,
             status_since = CASE WHEN rik_status.status = excluded.status THEN rik_status.status_since ELSE excluded.status_since END,
             status = excluded.status, entry_id = excluded.entry_id, other_mir = excluded.other_mir, other_party = excluded.other_party,
             detail = excluded.detail, checked_at = excluded.checked_at`,
        )
        .bind(result.personId, result.source, result.mir, result.number, result.status, result.entryId, result.otherMir, result.otherParty, result.detail, stamp, stamp),
    )
  }
  for (const one of tasks) {
    statements.push(
      db
        .prepare(
          `INSERT INTO rik_tasks (id, person_id, mir, type, reason, detail, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET detail = excluded.detail, mir = excluded.mir, active = 1, updated_at = excluded.updated_at`,
        )
        .bind(one.id, one.personId, one.mir, one.type, one.reason, one.detail, stamp, stamp),
    )
  }
  await chunked(db, statements)
  // Causes that went away. People no longer holding a number drop out of rik_status.
  // Frozen МИР (blocked by the site) are left exactly as they were.
  const keep = frozenMirs.length ? ` AND COALESCE(mir, '') NOT IN (${frozenMirs.map(() => '?').join(', ')})` : ''
  // Self-service change tasks are not the matcher's: only staff close them.
  await db.prepare(`UPDATE rik_tasks SET active = 0, updated_at = ? WHERE active = 1 AND updated_at < ? AND type != 'self_identity'${keep}`).bind(stamp, stamp, ...frozenMirs).run()
  await db.prepare(`DELETE FROM rik_status WHERE checked_at < ?${keep}`).bind(stamp, ...frozenMirs).run()
}

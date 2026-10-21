/**
 * The РИК sync: reads the CIK index of РИК sites, each РИК's представители (and застъпници)
 * register for this election, stores what changed, then re-derives statuses and tasks.
 * Runs from the Worker cron (src/server.ts) and from the admin „Синхронизирай“ button.
 *
 * Polite and resilient: one request at a time with a pause, a request budget per run, each РИК
 * at most every MIN_INTERVAL_MINUTES, unchanged pages (same SHA-256) cost no writes, and a failing
 * РИК is recorded and skipped without stopping the others. Idempotent: entries are keyed by
 * МИР + register + party + name + number, so re-reading a page, a page split into batches or a
 * batch merged into another never duplicates a row.
 *
 * It never writes signups, partner_people, sections or drafts, never removes anyone and never
 * mails: it only fills the rik_* tables.
 */
import type { SignupD1 } from '../db-core'
import {
  ABROAD_MIR,
  CIK_RIK_INDEX_URL,
  CONTACTS_INTERVAL_MINUTES,
  DEFAULT_FETCH_BUDGET,
  DOMESTIC_MIRS,
  FETCH_PAUSE_MS,
  INDEX_INTERVAL_MINUTES,
  MANUAL_CHECK_AFTER_FAILURES,
  MIN_INTERVAL_MINUTES,
  OTHER_PARTY_INTERVAL_MINUTES,
  RIK_ELECTION,
  USER_AGENT,
  defaultElectionBase,
  isOurCommittee,
  mirLabel,
  registerUrl,
  type RegisterKind,
} from './config'
import { matchAll, type DerivedTask, type PersonResult, type RikEntryRow, type RikPerson, type RikSourceHealth } from './match'
import { isAnnulledName, joinNames, nameKey, parseNumberWithDate, sha256Hex } from './normalize'
import { electionBaseOf, parseContacts, parseRegisterBatch, parseRegisterList, parseRikIndex } from './parse'
import { RIK_INDEXES, RIK_TABLES } from './sql'

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
}

export interface SyncSummary {
  runId: string
  fetched: number
  changed: number
  errors: number
  synced: string[]
  skipped: string[]
  budgetLeft: number
  statuses: Record<string, number>
  tasks: Record<string, number>
}

const ensured = new WeakSet<object>()

export async function ensureRikTables(db: SignupD1) {
  if (ensured.has(db)) return
  for (const sql of RIK_TABLES) await db.prepare(sql).run()
  for (const sql of RIK_INDEXES) await db.prepare(sql).run()
  ensured.add(db)
}

class BudgetSpent extends Error {}

interface Page {
  status: number
  body: string
  hash: string
}

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

/** Everyone who holds a пълномощно number: signups (incl. mobile teams) and „И аз“ partner people. */
export const RIK_PEOPLE_SQL = `
SELECT id, 'signup' AS source, COALESCE(designation_mir, '') AS mir, designation_number AS number,
       COALESCE(designation_issued_at, '') AS issued_on,
       COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
       COALESCE(json_extract(payload, '$.middleName'), '') AS middle_name,
       COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
       COALESCE(withdrawn, 0) AS withdrawn,
       COALESCE(designation_first_signed_at, designation_signed_at) AS signed_at
FROM signups WHERE designation_number IS NOT NULL AND COALESCE(designation_mir, '') != ''
UNION ALL
SELECT id, 'partner' AS source, COALESCE(designation_mir, '') AS mir, designation_number AS number,
       COALESCE(designation_issued_at, '') AS issued_on, first_name, middle_name, last_name, 0 AS withdrawn,
       COALESCE(designation_first_signed_at, designation_signed_at) AS signed_at
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
}

export async function loadPeople(db: SignupD1): Promise<RikPerson[]> {
  const rows = (await db.prepare(RIK_PEOPLE_SQL).all<PersonRow>()).results ?? []
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    mir: String(row.mir).padStart(2, '0'),
    number: row.number == null ? null : Number(row.number),
    issuedOn: (row.issued_on ?? '').trim(),
    nameKey: nameKey(joinNames(row.first_name ?? '', row.middle_name ?? '', row.last_name ?? '')),
    withdrawn: Number(row.withdrawn) === 1,
    signedAt: row.signed_at || null,
  }))
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
}

export function createRikSync(db: SignupD1, options: SyncOptions) {
  const now = options.now ?? (() => new Date())
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  const pause = options.pauseMs ?? FETCH_PAUSE_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let budget = options.budget ?? DEFAULT_FETCH_BUDGET
  let fetched = 0
  let changed = 0

  async function get(url: string): Promise<Page> {
    if (budget <= 0) throw new BudgetSpent('budget')
    if (fetched > 0 && pause > 0) await sleep(pause)
    budget -= 1
    fetched += 1
    const response = await fetcher(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': 'bg' },
      redirect: 'follow',
    })
    const body = response.status === 200 ? await response.text() : ''
    return { status: response.status, body, hash: body ? await sha256Hex(body) : '' }
  }

  async function previousPage(url: string) {
    return db.prepare('SELECT content_hash, fetched_at, rows FROM rik_pages WHERE url = ?').bind(url).first<{ content_hash: string; fetched_at: string; rows: number }>()
  }

  async function savePage(url: string, mir: string, kind: string, party: string, ours: boolean, page: Page, rows: number, stamp: string) {
    const before = await previousPage(url)
    const isChange = !before || before.content_hash !== page.hash
    if (isChange) changed += 1
    await db
      .prepare(
        `INSERT INTO rik_pages (url, mir, kind, party, ours, content_hash, http_status, rows, fetched_at, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET party = excluded.party, ours = excluded.ours, content_hash = excluded.content_hash,
           http_status = excluded.http_status, rows = excluded.rows, fetched_at = excluded.fetched_at,
           changed_at = CASE WHEN rik_pages.content_hash = excluded.content_hash THEN rik_pages.changed_at ELSE excluded.changed_at END`,
      )
      .bind(url, mir, kind, party, ours ? 1 : 0, page.hash, page.status, rows, stamp, stamp)
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
  async function readRegister(mir: string, base: string, kind: RegisterKind, ourKeys: Set<string>, stamp: string) {
    const listUrl = registerUrl(base, kind)
    const list = await get(listUrl)
    if (list.status === 404) return { state: 'not_published' as const, pages: 1, batches: 0, rows: [], unchangedSources: [] as string[] }
    if (list.status !== 200) throw new Error(`HTTP ${list.status} за ${listUrl}`)
    const parsed = parseRegisterList(list.body, listUrl)
    await savePage(listUrl, mir, `${kind}-list`, '', false, list, parsed.batches.length, stamp)
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
      if (page.status !== 200) continue
      const more = parseRegisterList(page.body, next)
      for (const batch of more.batches) batchUrls.set(batch.url, { party: batch.party, ours: isOurCommittee(batch.party) })
      for (const link of more.pages) if (!seenList.has(link)) queue.push(link)
    }
    const rows: Array<{ party: string; ours: boolean; url: string; name: string; number: string }> = []
    const unchangedSources: string[] = []
    let pages = seenList.size
    for (const [url, meta] of batchUrls) {
      if (!meta.ours && !options.force) {
        const before = await previousPage(url)
        if (before && minutesSince(before.fetched_at, now()) < OTHER_PARTY_INTERVAL_MINUTES) {
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
        const page = await get(pageUrl)
        pages += 1
        if (page.status !== 200) throw new Error(`HTTP ${page.status} за ${pageUrl}`)
        const batch = parseRegisterBatch(page.body, pageUrl)
        const party = meta.party || batch.party
        const ours = meta.ours || isOurCommittee(batch.party)
        await savePage(pageUrl, mir, `${kind}-batch`, party, ours, page, batch.rows.length, stamp)
        for (const row of batch.rows) {
          if (!ours && !ourKeys.has(nameKey(row.name))) continue
          rows.push({ party, ours, url, name: row.name, number: row.number })
        }
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

  async function syncOne(source: SourceRow, ourKeys: Set<string>) {
    const stamp = now().toISOString()
    await db.prepare('UPDATE rik_sources SET last_attempt_at = ? WHERE mir = ?').bind(stamp, source.mir).run()
    const base = source.base_url || defaultElectionBase(source.mir)
    const changedBefore = changed
    try {
      const reps = await readRegister(source.mir, base, 'representative', ourKeys, stamp)
      if (reps.state !== 'unrecognised') await saveEntries(source.mir, 'representative', reps.rows, reps.unchangedSources, stamp)
      let advPages = 0
      if (source.mir !== ABROAD_MIR && reps.state !== 'unrecognised') {
        try {
          const adv = await readRegister(source.mir, base, 'advocate', ourKeys, stamp)
          advPages = adv.pages
          if (adv.state !== 'unrecognised') await saveEntries(source.mir, 'advocate', adv.rows, adv.unchangedSources, stamp)
        } catch (error) {
          if (error instanceof BudgetSpent) throw error
          // Застъпници are secondary; a broken advocates page must not fail the РИК.
        }
      }
      try {
        await readContacts(source, stamp)
      } catch (error) {
        if (error instanceof BudgetSpent) throw error
      }
      const ourEntries = reps.rows.filter((row) => row.ours).length
      const otherMatches = reps.rows.filter((row) => !row.ours).length
      const health = reps.state
      await db
        .prepare(
          `UPDATE rik_sources SET health = ?, last_success_at = CASE WHEN ? = 'unrecognised' THEN last_success_at ELSE ? END,
             last_change_at = CASE WHEN ? > 0 THEN ? ELSE last_change_at END,
             last_error = ?, failures = CASE WHEN ? = 'unrecognised' THEN failures + 1 ELSE 0 END,
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
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300)
      await db
        .prepare(`UPDATE rik_sources SET health = 'error', last_error = ?, failures = failures + 1, updated_at = ? WHERE mir = ?`)
        .bind(message, stamp, source.mir)
        .run()
      // Too many subrequests: stop this run, the next one carries on.
      if (/too many subrequests/i.test(message)) throw new BudgetSpent(message)
      return false
    }
  }

  async function rematch() {
    const stamp = now().toISOString()
    const people = await loadPeople(db)
    const entries = ((await db.prepare(`SELECT id, mir, kind, ours, party, name, name_key, number, number_date, annulled, missing_since FROM rik_entries`).all<{
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
      }),
    )
    const sources = ((await db.prepare('SELECT mir, health, failures, last_error FROM rik_sources').all<{ mir: string; health: RikSourceHealth['health']; failures: number; last_error: string }>()).results ?? []).map(
      (row): RikSourceHealth => ({ mir: row.mir, health: row.health, failures: Number(row.failures), lastError: row.last_error }),
    )
    const { results, tasks } = matchAll(people, entries, sources, now(), MANUAL_CHECK_AFTER_FAILURES)
    await writeResults(db, results, tasks, stamp)
    const statuses: Record<string, number> = {}
    for (const result of results) statuses[result.status] = (statuses[result.status] ?? 0) + 1
    const taskCounts: Record<string, number> = {}
    for (const one of tasks) taskCounts[one.type] = (taskCounts[one.type] ?? 0) + 1
    return { statuses, tasks: taskCounts }
  }

  async function run(): Promise<SyncSummary> {
    await ensureRikTables(db)
    const runId = crypto.randomUUID()
    const started = now().toISOString()
    await db.prepare('INSERT INTO rik_runs (id, trigger, started_at) VALUES (?, ?, ?)').bind(runId, options.trigger, started).run()
    const synced: string[] = []
    const skipped: string[] = []
    let errors = 0
    let note = ''
    try {
      await refreshIndex(started)
      const sources = (await db.prepare('SELECT mir, name, base_url, contacts_url, contacts_at, health, last_attempt_at, failures, last_error FROM rik_sources ORDER BY COALESCE(last_attempt_at, \'\') ASC, mir ASC').all<SourceRow>()).results ?? []
      const people = await loadPeople(db)
      const ourKeys = new Set(people.map((person) => person.nameKey).filter(Boolean))
      for (const source of sources) {
        if (options.mirs?.length && !options.mirs.includes(source.mir)) continue
        if (!options.force && minutesSince(source.last_attempt_at, now()) < MIN_INTERVAL_MINUTES) {
          skipped.push(source.mir)
          continue
        }
        const ok = await syncOne(source, ourKeys)
        if (ok) synced.push(source.mir)
        else errors += 1
      }
    } catch (error) {
      if (!(error instanceof BudgetSpent)) throw error
      note = 'Лимитът заявки за това пускане свърши; останалите РИК са в следващото.'
    }
    const counts = await rematch()
    await db
      .prepare('UPDATE rik_runs SET finished_at = ?, fetched = ?, changed = ?, errors = ?, note = ? WHERE id = ?')
      .bind(now().toISOString(), fetched, changed, errors, note || JSON.stringify(counts), runId)
      .run()
    return { runId, fetched, changed, errors, synced, skipped, budgetLeft: budget, ...counts }
  }

  return { run, rematch }
}

/** Upserts statuses and tasks. A task whose cause is gone becomes inactive; done/undo stays. */
export async function writeResults(db: SignupD1, results: PersonResult[], tasks: DerivedTask[], stamp: string) {
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
  await db.prepare('UPDATE rik_tasks SET active = 0, updated_at = ? WHERE active = 1 AND updated_at < ?').bind(stamp, stamp).run()
  await db.prepare('DELETE FROM rik_status WHERE checked_at < ?').bind(stamp).run()
}

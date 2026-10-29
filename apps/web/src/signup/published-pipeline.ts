/**
 * „Публикувана секция → напред“. Whoever holds a published section is moved forward at once:
 *
 * 1. numbered (пълномощно in the section's МИР), so the next „Само новите“ ZIP for signing holds them;
 * 2. volunteers only: their Brevo contact is upserted with the section attributes (and the signed
 *    link once there is one), on the configured list. Contacts only: no campaign, no mail, no SMS.
 *    „И аз“ people never go to our Brevo (they have their own); withdrawn people never go either.
 *
 * Runs right after every publish (adminPublish, adminPublishOne, adminPartnerPublish), from the
 * „Придвижи публикуваните“ button, and hourly from the cron for anyone left behind. Idempotent:
 * numbered rows are skipped by the guarded UPDATE, and a contact is sent once per publish
 * (brevo_section_synced = section@published_at).
 */
import { loadBrevoSectionFieldsForIds } from './admin'
import { readBrevoConfig } from './brevo'
import { gateDesignation, listPublishedPeople, numberListed, workerEnv } from './designation-bulk.server'
import { designationSectionAttributes, fetchBrevoAttributes, pushSectionContact, type BrevoAttrs, type DesignationBrevoResult } from './designation-brevo'
import { configFromEnv } from './designation-config'
import { signupDatabase, type SignupD1 } from './db-core'
import { isPartnerPersonId } from './partner-people-sql'
import {
  BREVO_SECTION_KEY_SQL,
  BREVO_SECTION_MARK_SQL,
  BREVO_SECTION_PENDING_WHERE,
  PIPELINE_COUNTS_SQL,
  describeAdvance,
  partnerMirFromSectionSql,
  pipelineCountsFrom,
  type AdvanceReport,
} from './published-pipeline-sql'

type Database = SignupD1

/** Contacts per run; the rest go on the next run (cron hourly). Each costs one or two Brevo calls. */
export const ADVANCE_BREVO_LIMIT = 150

export type BrevoTarget = { apiKey: string; listId: number | null; attribute: string }

export interface AdvanceDeps {
  /** null: Brevo is not configured (no key); numbering still runs. */
  brevo?: BrevoTarget | null
  fetchImpl?: typeof fetch
  sectionFields?: typeof loadBrevoSectionFieldsForIds
  now?: Date
  brevoLimit?: number
}

export function brevoTargetFromEnv(): BrevoTarget | null {
  const config = readBrevoConfig()
  if ('missing' in config) return null
  return { apiKey: config.apiKey, listId: config.listId, attribute: configFromEnv(workerEnv()).brevoAttribute.trim().toUpperCase() }
}

/**
 * Move people with a published section forward. `ids`: only these (signup and/or pp- ids), e.g. the
 * rows a publish just wrote; 'all': everyone (backfill and cron).
 */
export async function advancePublished(db: Database, scope: { ids: string[] } | 'all', actor: string, deps: AdvanceDeps = {}): Promise<AdvanceReport> {
  const now = deps.now ?? new Date()
  const ids = scope === 'all' ? null : [...new Set(scope.ids.map(String).filter(Boolean))]
  const partnerIds = ids ? ids.filter(isPartnerPersonId) : null
  let partnersMirSet = 0
  if (!partnerIds || partnerIds.length > 0) {
    const sql = partnerMirFromSectionSql(Boolean(partnerIds))
    const statement = partnerIds ? db.prepare(sql).bind(now.toISOString(), JSON.stringify(partnerIds)) : db.prepare(sql).bind(now.toISOString())
    const result = (await statement.run()) as { meta?: { changes?: number } }
    partnersMirSet = Number(result?.meta?.changes ?? 0) || 0
  }
  const listed = await listPublishedPeople(db, ids)
  const numbering = await numberListed(db, listed, actor, now)
  const brevo = await syncBrevoContacts(db, ids ? ids.filter((id) => !isPartnerPersonId(id)) : null, deps, now)
  const counts = pipelineCountsFrom(await db.prepare(PIPELINE_COUNTS_SQL).first<Record<string, unknown>>())
  return {
    numbered: numbering.assigned,
    numberedPartners: numbering.assignedIds.filter(isPartnerPersonId).length,
    skippedDuplicates: numbering.skippedDuplicates,
    skippedCovered: numbering.skippedCovered,
    partnersMirSet,
    brevo,
    counts,
  }
}

async function syncBrevoContacts(db: Database, ids: string[] | null, deps: AdvanceDeps, now: Date): Promise<AdvanceReport['brevo']> {
  if (ids && ids.length === 0) return { synced: 0, created: 0, failed: 0, left: 0 }
  const target = deps.brevo === undefined ? brevoTargetFromEnv() : deps.brevo
  const scoped = ids ? ' AND id IN (SELECT value FROM json_each(?))' : ''
  const binds = ids ? [JSON.stringify(ids)] : []
  const pending = await db
    .prepare(`SELECT COUNT(*) AS n FROM signups WHERE ${BREVO_SECTION_PENDING_WHERE}${scoped}`)
    .bind(...binds)
    .first<{ n: number }>()
  const total = Number(pending?.n ?? 0)
  if (total === 0) return { synced: 0, created: 0, failed: 0, left: 0 }
  if (!target) return { synced: 0, created: 0, failed: 0, left: total, skipped: 'липсва BREVO_API_KEY' }
  const limit = deps.brevoLimit ?? ADVANCE_BREVO_LIMIT
  const rows =
    (
      await db
        .prepare(
          `SELECT id, TRIM(email) AS email, COALESCE(designation_pdf_url, '') AS url, ${BREVO_SECTION_KEY_SQL} AS sync_key
           FROM signups WHERE ${BREVO_SECTION_PENDING_WHERE}${scoped} ORDER BY published_at, id LIMIT ?`,
        )
        .bind(...binds, limit)
        .all<{ id: string; email: string; url: string; sync_key: string }>()
    ).results ?? []
  try {
    const fetchImpl = deps.fetchImpl ?? fetch
    const account = await fetchBrevoAttributes(target.apiKey, fetchImpl)
    const hasLink = account.some((attr) => attr.name.toUpperCase() === target.attribute)
    const fields = await (deps.sectionFields ?? loadBrevoSectionFieldsForIds)(db, rows.map((row) => row.id))
    const results: DesignationBrevoResult[] = []
    let index = 0
    const worker = async () => {
      while (index < rows.length) {
        const row = rows[index]!
        index += 1
        const mine = fields.get(row.id)
        if (!mine) {
          results.push({ personId: row.id, ok: false, error: 'няма секция за Brevo' })
          continue
        }
        const attributes: BrevoAttrs = designationSectionAttributes(mine, account)
        if (row.url && hasLink) attributes[target.attribute] = row.url
        const result = await pushSectionContact({ apiKey: target.apiKey, listId: target.listId, personId: row.id, email: row.email, attributes, fetchImpl })
        if (result.ok) await db.prepare(BREVO_SECTION_MARK_SQL).bind(row.sync_key, now.toISOString(), row.id).run()
        results.push(result)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker))
    const failed = results.filter((row) => !row.ok)
    return {
      synced: results.length - failed.length,
      created: results.filter((row) => row.ok && row.created).length,
      failed: failed.length,
      left: Math.max(0, total - rows.length),
      ...(failed[0]?.error ? { firstError: failed[0].error } : {}),
    }
  } catch (error) {
    return { synced: 0, created: 0, failed: rows.length, left: Math.max(0, total - rows.length), firstError: error instanceof Error ? error.message : 'Brevo повикването се провали.' }
  }
}

/**
 * After a publish: never fails it. A numbering or Brevo error is logged and shown in the message;
 * the hourly run picks the person up again.
 */
export async function advanceAfterPublish(db: Database, ids: string[], actor: string, deps: AdvanceDeps = {}): Promise<AdvanceReport | { error: string }> {
  if (ids.length === 0) return { error: '' }
  try {
    const report = await advancePublished(db, { ids }, actor, deps)
    logAdvance('publish', report)
    return report
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('published pipeline after publish failed', JSON.stringify({ people: ids.length, message }))
    return { error: message }
  }
}

/** Counts only, never names or e-mails. */
export function logAdvance(trigger: string, report: AdvanceReport) {
  const log = report.brevo.failed > 0 ? console.warn : console.info
  log(
    'published pipeline',
    JSON.stringify({
      trigger,
      numbered: report.numbered,
      numberedPartners: report.numberedPartners,
      skippedDuplicates: report.skippedDuplicates,
      skippedCovered: report.skippedCovered,
      partnersMirSet: report.partnersMirSet,
      brevoSynced: report.brevo.synced,
      brevoCreated: report.brevo.created,
      brevoFailed: report.brevo.failed,
      brevoLeft: report.brevo.left,
      brevoSkipped: report.brevo.skipped ?? null,
      firstError: report.brevo.firstError ?? null,
      counts: report.counts,
    }),
  )
}

/** „Придвижи публикуваните“ on /admin/palnomoshtni: the hourly run, now. */
export async function handleAdvancePublished() {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) return access
  const report = await advancePublished(access.db, 'all', access.email)
  logAdvance('button', report)
  return { ok: true as const, report, message: describeAdvance(report).trim() }
}

/** Counts for the panel (who is where after publishing). */
export async function handlePipelineCounts() {
  const access = await gateDesignation('view')
  if (!access.ok) return access
  return { ok: true as const, counts: pipelineCountsFrom(await access.db.prepare(PIPELINE_COUNTS_SQL).first<Record<string, unknown>>()) }
}

/** Cron (hourly, production): backfill and anyone a publish left behind. Never throws. */
export async function runScheduledPublishedAdvance(cron: string, deps: AdvanceDeps & { db?: Database | null } = {}) {
  try {
    const db = deps.db === undefined ? await signupDatabase() : deps.db
    if (!db) {
      console.warn('published pipeline cron: no database', JSON.stringify({ cron }))
      return null
    }
    const report = await advancePublished(db, 'all', 'cron', deps)
    logAdvance(`cron ${cron}`, report)
    return report
  } catch (error) {
    console.warn('published pipeline cron failed', JSON.stringify({ cron, message: error instanceof Error ? error.message : String(error) }))
    return null
  }
}

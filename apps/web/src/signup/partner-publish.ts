import type { SignupD1 } from './db-core'
import { designationMirMessage, designationMirMismatch } from './designation-mir-guard'
import { PARTNER_RESERVATION_ORG, isSectionHeldAbort } from './partner-people-sql'
import { PARTNER_BLOCKED_SQL, code9, publishStatements } from './partner-sections'

/**
 * Publishing „И аз“ partner drafts, shared by „И аз“ — секции (adminPartnerPublish) and the bulk
 * „Публикувай черновите в този изглед“ on /admin/sections (adminPublish). Only section_published and
 * the „И аз“ reservation: no email, no Brevo, no profile, no login. Withdrawn people are never
 * published; a draft outside the пълномощно's МИР is refused (designation-mir-guard.ts).
 */
type Database = Pick<SignupD1, 'prepare' | 'batch'>

export interface PartnerPublishScope {
  /** Only these ids (the „И аз“ tab's per-row publish). Empty: every pending draft in the scope. */
  ids?: readonly string[]
  /** 'mir' with a МИР: drafts in that МИР. 'abroad': drafts abroad (МИР 32). Anything else: all. */
  view?: string
  mir?: string
}

export interface PartnerPendingRow {
  id: string
  mir: string
  number: number | null
  draft: string
  published: string
}

export const PARTNER_PENDING_SQL = `SELECT id, COALESCE(designation_mir, '') AS mir, designation_number AS number, section_draft AS draft,
  COALESCE(section_published, '') AS published FROM partner_people
WHERE withdrawn_at IS NULL AND COALESCE(section_draft, '') != '' AND section_draft IS NOT section_published`

export async function pendingPartnerDrafts(db: Pick<SignupD1, 'prepare'>, scope: PartnerPublishScope = {}) {
  const rows = (await db.prepare(PARTNER_PENDING_SQL).all<PartnerPendingRow>()).results ?? []
  return rows.filter((row) => inScope(row, scope))
}

export function inScope(row: Pick<PartnerPendingRow, 'id' | 'draft'>, scope: PartnerPublishScope) {
  if (scope.ids && scope.ids.length > 0 && !scope.ids.includes(row.id)) return false
  const draft = code9(row.draft)
  if (scope.view === 'abroad') return draft.startsWith('32')
  if (scope.view === 'mir') {
    const mir = String(scope.mir ?? '').trim().padStart(2, '0')
    return /^\d{2}$/.test(mir) ? draft.startsWith(mir) : false
  }
  return true
}

/** What a publish would do now: how many would go out, and how many a МИР mismatch stops. */
export async function previewPartnerPublish(db: Pick<SignupD1, 'prepare'>, scope: PartnerPublishScope = {}) {
  const rows = await pendingPartnerDrafts(db, scope)
  // A МИР mismatch is only a warning: every pending draft goes out.
  return { pending: rows.length, mismatched: 0 }
}

export async function publishPartnerDrafts(db: Database, scope: PartnerPublishScope = {}, now = new Date().toISOString()) {
  const rows = await pendingPartnerDrafts(db, scope)
  let published = 0
  const blocked: Array<{ id: string; section: string; reason: string }> = []
  const warnings: Array<{ id: string; section: string; reason: string }> = []
  for (const row of rows) {
    // Outside the пълномощно's МИР: published anyway, with a warning (staff decide).
    const mismatch = designationMirMismatch({ designationMir: row.mir, designationNumber: row.number, section: row.draft })
    const holder = await partnerHolderOf(db, row.draft, row.id)
    if (holder) {
      blocked.push({ id: row.id, section: row.draft, reason: holder })
      continue
    }
    try {
      await db.batch(publishStatements(db, row, now))
      published += 1
      if (mismatch) warnings.push({ id: row.id, section: row.draft, reason: designationMirMessage(mismatch) })
    } catch (error) {
      if (!isSectionHeldAbort(error)) throw error
      blocked.push({ id: row.id, section: row.draft, reason: 'заета' })
    }
  }
  return { published, blocked, warnings }
}

export function describePartnerPublish(result: { published: number; blocked: Array<{ reason: string }>; warnings?: Array<{ reason: string }> }) {
  const mismatched = result.blocked.filter((row) => row.reason.startsWith('Секция извън МИР')).length
  const taken = result.blocked.length - mismatched
  const stopped = [taken ? `${taken} заета секция` : '', mismatched ? `${mismatched} секция извън МИР на пълномощното` : ''].filter(Boolean).join(', ')
  return `Публикувани ${result.published}${stopped ? `, спрени ${result.blocked.length} (${stopped})` : ''}. Секциите са резервирани като „${PARTNER_RESERVATION_ORG}“. Без писма и без Brevo.${result.warnings?.length ? ` ${result.warnings.map((row) => row.reason).join(' ')}` : ''}`
}

/** Who else holds this code, in words, or ''. */
export async function partnerHolderOf(db: Pick<SignupD1, 'prepare'>, code: string, personId: string) {
  const rows = (await db.prepare(PARTNER_BLOCKED_SQL).all<{ code: string; src: string }>()).results ?? []
  const own = `partner:${personId}`
  for (const row of rows) {
    if (code9(row.code ?? '') !== code || row.src === own) continue
    if (row.src === 'taken') {
      const taken = await db.prepare('SELECT organisation FROM taken_sections WHERE section_code = ?').bind(code).first<{ organisation: string }>()
      // The person's own „И аз“ reservation (published here) is theirs.
      const mine = await db.prepare('SELECT 1 AS x FROM partner_people WHERE id = ? AND section_published = ?').bind(personId, code).first<{ x: number }>()
      if (mine) continue
      return `резервирана от ${taken?.organisation ?? 'друга организация'}`
    }
    if (row.src === 'signup') return 'наш записан човек'
    if (row.src === 'mobile') return 'цел на мобилен екип'
    return 'друг човек от „И аз“'
  }
  return ''
}

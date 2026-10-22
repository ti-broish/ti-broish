import { getCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { BrevoApiError, readBrevoConfig } from './brevo'
import { loadBrevoSectionFieldsForIds } from './admin'
import {
  designationSectionAttributes,
  fetchBrevoAttributeNames,
  fetchBrevoAttributes,
  pushDesignationLink,
  syncDesignationLinks,
  type DesignationBrevoContact,
  type DesignationBrevoResult,
} from './designation-brevo'
import { configFromEnv, ELECTION_DISTRICTS, todayInSofia } from './designation-config'
import {
  designationDriveFolderId,
  designationHealthMessage,
  probeDesignationDriveHealth,
  tryReadDriveAuth,
} from './designation-drive-core'
import {
  DESIGNATION_ZIP_BATCH_LIMIT,
  designationCountsPart,
  mirFromSection,
  mirLabel,
  type DesignationCounts,
  type DesignationPartnerCounts,
  type DesignationMirOption,
  type DesignationPersonView,
} from './designation-files'
import { DESIGNATION_ASSIGN_SQL, PARTNER_DESIGNATION_ASSIGN_SQL, designationMirOf, parseStoredNumber } from './designation-number'
import { brevoSignupIds } from './partner-people-sql'
import { SIGNUP_DESIGNATION_SECTION_SQL, isPlaceholderEmail } from './designation-section-sql'
import {
  EGN_HOLDERS_SQL,
  duplicateOf,
  egnKeySql,
  holderFromRow,
  keepersByEgn,
  planEgnGuard,
  type DuplicateMark,
  type EgnHolder,
} from './designation-duplicates'
import { designationNumberAuditSql } from './designation-audit-sql'
import { numberingMessage } from './designation-number-message'
import { addToSignScopeCounts, emptySignScopeCounts } from './designation-sign-scope'
import { runSqlBatches } from './designation-sql'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
export type DesignationDenial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

interface ListedPerson {
  designationMir?: string
  assignedSection?: string
  id: string
  firstName: string
  middleName: string
  lastName: string
  email: string
  section: string
  number: number | null
  issuedAt: string | null
  generatedAt: string | null
  signingGeneratedAt: string | null
  signedAt: string | null
  driveUrl: string | null
  driveFileId: string | null
  createdAt: string
  /** Partner slug for people from partner_people („И аз“); their `section` is only the МИР. */
  partner?: string
  /** Normalised ЕГН, server-side only (never in the view). */
  egnKey: string
  /** Partner only: withdrawn пълномощно. */
  withdrawnAt: string | null
  withdrawnReason: string | null
  /** Partner only: an active volunteer has the same ЕГН (marked on import). */
  covered: boolean
}

export function workerEnv(): Record<string, string | undefined> {
  return env as unknown as Record<string, string | undefined>
}

export async function gateDesignation(
  action: StaffAction,
): Promise<{ ok: true; db: Database; email: string; role: StaffRole } | DesignationDenial> {
  const db = await signupDatabase()
  if (!db) return { ok: false, state: 'nodb', email: '', message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{
    email: string
    email_confirmed: number
  }>()
  if (!session) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  if (!session.email_confirmed) return { ok: false, state: 'unconfirmed', email, message: 'Потвърди имейла, за да влезеш в екипа.' }
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role) return { ok: false, state: 'forbidden', email, message: 'Този имейл не е поканен в екипа.' }
  if (!roleAllows(role, action)) return { ok: false, state: 'forbidden', email, message: 'Тази роля няма това право.' }
  return { ok: true, db, email, role }
}

const LIST_SQL = `SELECT id,
  COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
  COALESCE(json_extract(payload, '$.middleName'), '') AS middle_name,
  COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
  COALESCE(email, '') AS email,
  ${SIGNUP_DESIGNATION_SECTION_SQL} AS section,
  COALESCE(designation_mir, '') AS designation_mir,
  COALESCE(NULLIF(draft_section, ''), published_section, '') AS assigned_section,
  designation_number,
  designation_issued_at,
  designation_generated_at,
  designation_signing_generated_at,
  designation_signed_at,
  designation_pdf_url,
  designation_drive_file_id,
  created_at,
  ${egnKeySql('egn')} AS egn_key
  FROM signups
  WHERE ${SIGNUP_DESIGNATION_SECTION_SQL} != '' AND COALESCE(withdrawn, 0) = 0`

/**
 * „И аз“ partner people: not signups, only here for пълномощни. Their МИР stands in for the
 * section (the document names only the МИР), so numbering, filenames and the ZIP work the same.
 */
const PARTNER_LIST_SQL = `SELECT id, first_name, middle_name, last_name, email,
  COALESCE(designation_mir, '') AS section,
  COALESCE(designation_mir, '') AS designation_mir,
  COALESCE(NULLIF(section_draft, ''), section_published, '') AS assigned_section,
  designation_number, designation_issued_at, designation_generated_at, designation_signing_generated_at, designation_signed_at,
  designation_pdf_url, designation_drive_file_id,
  imported_at AS created_at, partner,
  ${egnKeySql('egn')} AS egn_key, withdrawn_at, withdrawn_reason,
  CASE WHEN EXISTS (SELECT 1 FROM signups c WHERE c.id = partner_people.covered_by_signup_id AND COALESCE(c.withdrawn, 0) = 0) THEN 1 ELSE 0 END AS covered
  FROM partner_people`

interface RawListed {
  id: string
  first_name: string
  middle_name: string
  last_name: string
  email: string
  section: string
  designation_mir?: string | null
  assigned_section?: string | null
  designation_number: number | string | null
  designation_issued_at: string | null
  designation_generated_at: string | null
  designation_signing_generated_at?: string | null
  designation_signed_at: string | null
  designation_pdf_url: string | null
  designation_drive_file_id: string | null
  created_at: string
  partner?: string | null
  egn_key?: string | null
  withdrawn_at?: string | null
  withdrawn_reason?: string | null
  covered?: number | null
}

function fromRaw(row: RawListed): ListedPerson {
  const firstName = String(row.first_name ?? '').trim()
  const middleName = String(row.middle_name ?? '').trim()
  const lastName = String(row.last_name ?? '').trim()
  return {
    id: row.id,
    firstName,
    middleName,
    lastName,
    email: String(row.email ?? '').trim(),
    section: String(row.section ?? '').trim(),
    number: parseStoredNumber(row.designation_number),
    issuedAt: (row.designation_issued_at ?? '').trim() || null,
    generatedAt: (row.designation_generated_at ?? '').trim() || null,
    signingGeneratedAt: (row.designation_signing_generated_at ?? '').trim() || null,
    signedAt: (row.designation_signed_at ?? '').trim() || null,
    driveUrl: (row.designation_pdf_url ?? '').trim() || null,
    driveFileId: (row.designation_drive_file_id ?? '').trim() || null,
    createdAt: row.created_at ?? '',
    ...(row.partner ? { partner: String(row.partner) } : {}),
    egnKey: String(row.egn_key ?? ''),
    withdrawnAt: (row.withdrawn_at ?? '').trim() || null,
    withdrawnReason: (row.withdrawn_reason ?? '').trim() || null,
    covered: Number(row.covered ?? 0) === 1,
    designationMir: String(row.designation_mir ?? '').trim(),
    assignedSection: String(row.assigned_section ?? '').trim(),
  }
}

function displayName(person: ListedPerson) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ') || 'без име'
}

function toView(person: ListedPerson, duplicate: DuplicateMark | null = null): DesignationPersonView {
  const mir = mirFromSection(person.section)
  return {
    id: person.id,
    number: person.number,
    name: displayName(person),
    firstName: person.firstName,
    middleName: person.middleName,
    lastName: person.lastName,
    section: person.section,
    mir,
    generatedAt: person.generatedAt,
    signedAt: person.signedAt,
    driveUrl: person.driveUrl,
    hasDriveFile: Boolean(person.driveFileId),
    ...(person.partner ? { partner: person.partner } : {}),
    ...(duplicate ? { duplicateOf: { number: duplicate.number, mir: duplicate.mir } } : {}),
    ...(person.withdrawnAt ? { withdrawnAt: person.withdrawnAt, withdrawnReason: person.withdrawnReason ?? '' } : {}),
    ...(person.covered ? { covered: true } : {}),
    ...(person.designationMir ? { designationMir: person.designationMir } : {}),
    ...(person.assignedSection ? { assignedSection: person.assignedSection } : {}),
  }
}

async function loadHolders(db: Database): Promise<EgnHolder[]> {
  const result = await db.prepare(EGN_HOLDERS_SQL).all<{ id: string; kind: string; egn_key: string; mir: string | null; number: number | string | null; published: number | null }>()
  return (result.results ?? []).map(holderFromRow).filter((row): row is EgnHolder => row != null)
}

/** Withdrawn „И аз“ rows and duplicates never go to a ZIP for signing or the „За подпис“ counts. */
function signable(person: ListedPerson, duplicate: DuplicateMark | null) {
  return !person.withdrawnAt && !duplicate
}

function matchesFilter(person: ListedPerson, mir: string, q: string) {
  if (mir && mirFromSection(person.section) !== mir) return false
  if (!q) return true
  const hay = `${displayName(person)} ${person.section} ${person.number ?? ''} ${person.partner ? 'и аз' : ''}`.toLowerCase()
  return hay.includes(q.toLowerCase())
}

async function listPublished(db: Database): Promise<ListedPerson[]> {
  const result = await db.prepare(LIST_SQL).all<RawListed>()
  return (result.results ?? []).map(fromRaw)
}

async function listPartnerPeople(db: Database): Promise<ListedPerson[]> {
  const result = await db.prepare(PARTNER_LIST_SQL).all<RawListed>()
  return (result.results ?? []).map(fromRaw)
}

export async function handleDesignationStatus(data: { mir: string; q: string }) {
  const access = await gateDesignation('view')
  if (!access.ok) return access
  const all = await listPublished(access.db)
  const partners = await listPartnerPeople(access.db)
  const keepers = keepersByEgn(await loadHolders(access.db))
  const dup = new Map<string, DuplicateMark>()
  for (const row of [...all, ...partners]) {
    if (row.withdrawnAt) continue
    const mark = duplicateOf(row, keepers)
    if (mark) dup.set(row.id, mark)
  }
  const dupOf = (row: ListedPerson) => dup.get(row.id) ?? null
  const activePartners = partners.filter((row) => !row.withdrawnAt)
  // Everyone who can get one: volunteers plus active „И аз“, without withdrawn rows and ЕГН
  // duplicates, so the totals line up with the signing ZIP scopes.
  const countable = [...all, ...partners].filter((row) => signable(row, dupOf(row)))
  const counts: DesignationCounts = {
    ...designationCountsPart(countable),
    partner: designationCountsPart(countable.filter((row) => row.partner)),
    duplicates: dup.size,
  }
  // „И аз“ detail line (withdrawn, covered, no МИР); its totals are already in counts.partner.
  const partnerCounts: DesignationPartnerCounts = {
    total: activePartners.length,
    numbered: activePartners.filter((row) => row.number != null).length,
    noMir: activePartners.filter((row) => !row.section).length,
    signed: activePartners.filter((row) => row.signedAt).length,
    withdrawn: partners.length - activePartners.length,
    covered: activePartners.filter((row) => row.covered).length,
  }
  const everyone = [...all, ...partners]
  const mirsMap = new Map<string, number>()
  for (const row of everyone) {
    // An оттеглено „И аз“ row stays listed with its badge but is not counted under its МИР.
    if (row.withdrawnAt) continue
    const code = mirFromSection(row.section)
    if (!code) continue
    mirsMap.set(code, (mirsMap.get(code) ?? 0) + 1)
  }
  const mirs: DesignationMirOption[] = [...mirsMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => ({ code, label: mirLabel(code) || `${code} ${ELECTION_DISTRICTS[code] ?? ''}`.trim(), count }))
  const listed = everyone.filter((row) => matchesFilter(row, data.mir, data.q))
  const people = listed.map((row) => toView(row, dupOf(row)))
  const zipEligible = listed.filter((row) => row.number != null && signable(row, dupOf(row))).length
  // Per scope for the signing ZIP: МИР filter only (the ZIP ignores the search box).
  const inMir = everyone.filter((row) => matchesFilter(row, data.mir, '') && signable(row, dupOf(row)))
  const scopeCounts = inMir.reduce(addToSignScopeCounts, emptySignScopeCounts())
  // The volunteer share of scopeCounts; the rest are „И аз“ partner people.
  const volunteerScopeCounts = inMir.filter((row) => !row.partner).reduce(addToSignScopeCounts, emptySignScopeCounts())
  const partnerScopeCounts = partners.filter((row) => signable(row, dupOf(row))).reduce(addToSignScopeCounts, emptySignScopeCounts())
  return {
    ok: true as const,
    counts,
    partnerCounts,
    people,
    mirs,
    zipEligible,
    scopeCounts,
    volunteerScopeCounts,
    partnerScopeCounts,
    zipBatchLimit: DESIGNATION_ZIP_BATCH_LIMIT,
  }
}

export async function handleDesignationNumber() {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) return access
  const listed = [...(await listPublished(access.db)), ...(await listPartnerPeople(access.db))]
  const issuedOn = todayInSofia()
  const now = new Date().toISOString()
  const ordered = [...listed].sort((a, b) => {
    const section = a.section.localeCompare(b.section)
    if (section) return section
    const created = a.createdAt.localeCompare(b.createdAt)
    if (created) return created
    return a.id.localeCompare(b.id)
  })
  // Per-МИР MAX+1 from 501 inside each UPDATE, so concurrent runs cannot collide.
  const unnumbered = ordered.filter((row) => row.number == null && designationMirOf(row.section))
  // One person, one пълномощно: an ЕГН that already holds a number (either table), or that came up
  // earlier in this run (volunteers first), is skipped. The UPDATEs check the same, so parallel runs are safe.
  const guard = planEgnGuard(
    unnumbered.map((row) => ({
      id: row.id,
      kind: row.partner ? ('partner' as const) : ('signup' as const),
      egnKey: row.egnKey,
      covered: row.covered,
      withdrawn: Boolean(row.withdrawnAt),
    })),
    await loadHolders(access.db),
  )
  const toAssign = unnumbered.filter((row) => guard.allowed.has(row.id))
  // Partner people share the counter (PARTNER_DESIGNATION_ASSIGN_SQL), so numbers never collide.
  // Each UPDATE is followed by its audit line, written only when that UPDATE numbered the row.
  const assignStatements = toAssign.flatMap((row) => [
    access.db
      .prepare(row.partner ? PARTNER_DESIGNATION_ASSIGN_SQL : DESIGNATION_ASSIGN_SQL)
      .bind(designationMirOf(row.section), issuedOn, now, row.id),
    access.db
      .prepare(designationNumberAuditSql(row.partner ? 'partner_people' : 'signups'))
      .bind(crypto.randomUUID(), access.email, now, row.id),
  ])
  const dateStatements = ordered
    .filter((row) => row.number != null && !row.issuedAt)
    .map((row) =>
      access.db
        .prepare(
          `UPDATE ${row.partner ? 'partner_people' : 'signups'} SET designation_issued_at = ?, updated_at = ? WHERE id = ? AND designation_issued_at IS NULL`,
        )
        .bind(issuedOn, now, row.id),
    )
  await runSqlBatches(access.db, [...assignStatements, ...dateStatements])
  // Count what really got a number: a parallel run may have taken an ЕГН in between.
  const after = toAssign.length
    ? await countNumbered(access.db, toAssign.map((row) => row.id))
    : 0
  const assigned = after
  const duplicates = guard.skipped.filter((row) => row.reason === 'duplicate').length + (toAssign.length - after)
  const covered = guard.skipped.filter((row) => row.reason === 'covered').length
  return {
    ok: true as const,
    assigned,
    skippedDuplicates: duplicates,
    skippedCovered: covered,
    updated: assigned + dateStatements.length,
    message: numberingMessage(assigned, duplicates, covered),
  }
}

async function countNumbered(db: Database, ids: string[]) {
  let total = 0
  for (let start = 0; start < ids.length; start += 50) {
    const part = ids.slice(start, start + 50)
    const marks = part.map(() => '?').join(', ')
    const row = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM signups WHERE id IN (${marks}) AND designation_number IS NOT NULL)
              + (SELECT COUNT(*) FROM partner_people WHERE id IN (${marks}) AND designation_number IS NOT NULL) AS n`,
      )
      .bind(...part, ...part)
      .first<{ n: number }>()
    total += Number(row?.n ?? 0)
  }
  return total
}

export async function handleDesignationHealth() {
  const access = await gateDesignation('view')
  if (!access.ok) return access
  const bag = workerEnv()
  const health = await probeDesignationDriveHealth(bag)
  const auth = tryReadDriveAuth(bag)
  const canUpload = auth.ok && Boolean(designationDriveFolderId(bag)) && health.folderOk && health.folderIsFolder
  return {
    ok: true as const,
    health,
    canUpload,
    message: `${designationHealthMessage(health)}${await brevoAttributeNote(bag, health.brevoAttribute)}`,
  }
}

/** Say on the health line when the Brevo attribute for the link is missing; uploads would not reach Brevo. */
async function brevoAttributeNote(bag: Record<string, string | undefined>, attribute: string) {
  const apiKey = (bag.BREVO_API_KEY ?? '').trim()
  if (!apiKey) return ''
  try {
    const names = await fetchBrevoAttributeNames(apiKey)
    return names.has(attribute.toUpperCase()) ? '' : ` В Brevo няма атрибут ${attribute} — създай го (текст), иначе линковете няма да стигнат до Brevo.`
  } catch (error) {
    return ` Атрибутите в Brevo не се провериха: ${errorMessage(error)}`
  }
}

/** Who „Синхронизирай с Brevo“ sends: active (not withdrawn) signups with a signed пълномощно on Drive. */
export const DESIGNATION_BREVO_SCOPE_SQL = `COALESCE(designation_pdf_url, '') <> '' AND COALESCE(withdrawn, 0) = 0`

/** People per Brevo resync call; each costs one or two Brevo subrequests. */
export const DESIGNATION_BREVO_PAGE = 100

export type DesignationSyncInput = { personIds: string[]; allSigned: boolean; offset: number }

export async function handleDesignationSyncBrevo(data: DesignationSyncInput) {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) return access
  // „И аз“ partner people never go to Brevo: only signup ids get through, and the
  // all-signed page reads the signups table only.
  data = { ...data, personIds: brevoSignupIds(data.personIds) }
  if (!data.allSigned && data.personIds.length === 0) return { ok: false as const, message: 'Няма хора за синхрон към Brevo.' }
  const config = readBrevoConfig()
  if ('missing' in config) {
    return {
      ok: false as const,
      skipped: true as const,
      message: 'Brevo: липсва BREVO_API_KEY. Линковете в Drive са записани.',
    }
  }
  const attribute = configFromEnv(workerEnv()).brevoAttribute
  let rows: Array<{ id: string; email: string; url: string }>
  let total = 0
  if (data.allSigned) {
    // Only signed, active people go to Brevo. Unsigned people are never sent; withdrawn people
    // are left out because their contact was cleaned on withdrawal and must not be put back.
    const count = await access.db.prepare(`SELECT COUNT(*) AS n FROM signups WHERE ${DESIGNATION_BREVO_SCOPE_SQL}`).first<{ n: number }>()
    total = Number(count?.n ?? 0)
    const page = await access.db
      .prepare(
        `SELECT id, email, COALESCE(designation_pdf_url, '') AS url FROM signups WHERE ${DESIGNATION_BREVO_SCOPE_SQL} ORDER BY id LIMIT ? OFFSET ?`,
      )
      .bind(DESIGNATION_BREVO_PAGE, data.offset)
      .all<{ id: string; email: string; url: string }>()
    rows = page.results ?? []
  } else {
    const marks = data.personIds.map(() => '?').join(', ')
    const found = await access.db
      .prepare(`SELECT id, email, COALESCE(designation_pdf_url, '') AS url FROM signups WHERE id IN (${marks}) AND COALESCE(withdrawn, 0) = 0`)
      .bind(...data.personIds)
      .all<{ id: string; email: string; url: string }>()
    rows = found.results ?? []
    total = rows.length
  }
  const contacts: DesignationBrevoContact[] = []
  const results: DesignationBrevoResult[] = []
  for (const row of rows) {
    const email = (row.email ?? '').trim()
    const url = (row.url ?? '').trim()
    if (!email || isPlaceholderEmail(email)) results.push({ personId: row.id, ok: false, error: 'няма имейл' })
    else if (!url) results.push({ personId: row.id, ok: false, error: 'няма подписано пълномощно (линк към Drive)' })
    else contacts.push({ personId: row.id, email, url })
  }
  const nextOffset = data.allSigned && data.offset + rows.length < total ? data.offset + rows.length : null
  if (contacts.length > 0) {
    try {
      const account = await fetchBrevoAttributes(config.apiKey)
      const sections = await loadBrevoSectionFieldsForIds(access.db, contacts.map((contact) => contact.personId))
      for (const contact of contacts) {
        const fields = sections.get(contact.personId)
        if (fields) contact.section = designationSectionAttributes(fields, account)
      }
      const sync = await syncDesignationLinks({ apiKey: config.apiKey, listId: config.listId, attribute, contacts, account })
      results.push(...sync.results)
    } catch (error) {
      const message = errorMessage(error)
      console.error('designation brevo sync failed', JSON.stringify({ attribute, contacts: contacts.length, message }))
      return { ok: false as const, attribute, total, results, nextOffset, message: `Brevo: ${message}` }
    }
  }
  const failed = results.filter((row) => !row.ok)
  const updated = results.length - failed.length
  const warned = results.filter((row) => row.ok && row.warning)
  const withSection = contacts.filter((contact) => contact.section && Object.keys(contact.section).length > 0).length
  // Counts only, no emails: shows in Workers Logs whether a sync ran and what Brevo answered.
  const log = failed.length > 0 ? console.warn : console.info
  log('designation brevo sync', JSON.stringify({ attribute, updated, failed: failed.length, withSection, sectionWarnings: warned.length, total, offset: data.offset, firstError: failed[0]?.error ?? null, firstWarning: warned[0]?.warning ?? null }))
  return {
    ok: failed.length === 0,
    attribute,
    updated,
    failed: failed.length,
    total,
    results,
    nextOffset,
    withSection,
    sectionWarnings: warned.length,
    message: `${designationBrevoMessage(attribute, updated, failed)}${sectionNote(withSection, warned.map((row) => row.warning ?? ''))}`,
  }
}

export type SignedLinkBrevo =
  | { ok: true; attribute: string; created?: boolean; warning?: string }
  | { ok: false; attribute: string; skipped?: boolean; error: string }

/**
 * Right after a signed upload: put the new Drive link on the person's Brevo contact.
 * The Drive link is already in D1, so a Brevo failure here never fails the upload;
 * „Синхронизирай с Brevo“ re-sends it later.
 */
export async function syncSignedLinkToBrevo(person: { id: string; email: string; url: string }, db?: SignupD1): Promise<SignedLinkBrevo> {
  const attribute = configFromEnv(workerEnv()).brevoAttribute.trim().toUpperCase()
  const config = readBrevoConfig()
  if ('missing' in config) return { ok: false, attribute, skipped: true, error: 'липсва BREVO_API_KEY' }
  const email = person.email.trim()
  if (!email || isPlaceholderEmail(email)) return { ok: false, attribute, skipped: true, error: 'няма имейл' }
  let section: Record<string, string | number | boolean | string[]> | undefined
  if (db) {
    try {
      const [account, fields] = await Promise.all([fetchBrevoAttributes(config.apiKey), loadBrevoSectionFieldsForIds(db, [person.id])])
      const mine = fields.get(person.id)
      if (mine) section = designationSectionAttributes(mine, account)
    } catch (error) {
      // The link still goes to Brevo; the Секции sync or the resync button fills the section later.
      console.warn('designation upload brevo section lookup failed', JSON.stringify({ error: errorMessage(error) }))
    }
  }
  const result = await pushDesignationLink({
    apiKey: config.apiKey,
    listId: config.listId,
    attribute,
    contact: { personId: person.id, email, url: person.url, section },
  })
  if (!result.ok) {
    console.warn('designation upload brevo failed', JSON.stringify({ attribute, error: result.error ?? null }))
    return { ok: false, attribute, error: result.error ?? 'Brevo повикването се провали.' }
  }
  return { ok: true, attribute, created: result.created, ...(result.warning ? { warning: result.warning } : {}) }
}

function sectionNote(withSection: number, warnings: string[]) {
  const parts = [` Секционни атрибути: изпратени за ${withSection}.`]
  if (warnings.length > 0) parts.push(` Отказани за ${warnings.length}: ${[...new Set(warnings)].slice(0, 2).join('; ')}`)
  return parts.join('')
}

/** One line for the admin page: "Brevo (DOCUMENT_URL): 1 обновени / 0 грешки" plus the distinct reasons. */
export function designationBrevoMessage(attribute: string, updated: number, failed: DesignationBrevoResult[]) {
  const head = `Brevo (${attribute}): ${updated} обновени / ${failed.length} грешки`
  if (failed.length === 0) return `${head}.`
  const reasons = [...new Set(failed.map((row) => row.error || 'неизвестна грешка'))].slice(0, 3)
  return `${head}: ${reasons.join('; ')}`
}

function errorMessage(error: unknown) {
  if (error instanceof BrevoApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Brevo повикването се провали.'
}

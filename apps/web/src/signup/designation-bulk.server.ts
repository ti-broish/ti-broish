import { getCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { BrevoApiError, readBrevoConfig } from './brevo'
import {
  fetchBrevoAttributeNames,
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
  mirFromSection,
  mirLabel,
  type DesignationCounts,
  type DesignationMirOption,
  type DesignationPersonView,
} from './designation-files'
import { DESIGNATION_ASSIGN_SQL, designationMirOf, parseStoredNumber } from './designation-number'
import { runSqlBatches } from './designation-sql'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
export type DesignationDenial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

interface ListedPerson {
  id: string
  firstName: string
  middleName: string
  lastName: string
  email: string
  section: string
  number: number | null
  issuedAt: string | null
  generatedAt: string | null
  signedAt: string | null
  driveUrl: string | null
  driveFileId: string | null
  createdAt: string
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
  COALESCE(published_section, '') AS section,
  designation_number,
  designation_issued_at,
  designation_generated_at,
  designation_signed_at,
  designation_pdf_url,
  designation_drive_file_id,
  created_at
  FROM signups
  WHERE COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0`

interface RawListed {
  id: string
  first_name: string
  middle_name: string
  last_name: string
  email: string
  section: string
  designation_number: number | string | null
  designation_issued_at: string | null
  designation_generated_at: string | null
  designation_signed_at: string | null
  designation_pdf_url: string | null
  designation_drive_file_id: string | null
  created_at: string
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
    signedAt: (row.designation_signed_at ?? '').trim() || null,
    driveUrl: (row.designation_pdf_url ?? '').trim() || null,
    driveFileId: (row.designation_drive_file_id ?? '').trim() || null,
    createdAt: row.created_at ?? '',
  }
}

function displayName(person: ListedPerson) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ') || 'без име'
}

function toView(person: ListedPerson): DesignationPersonView {
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
  }
}

function matchesFilter(person: ListedPerson, mir: string, q: string) {
  if (mir && mirFromSection(person.section) !== mir) return false
  if (!q) return true
  const hay = `${displayName(person)} ${person.section} ${person.number ?? ''}`.toLowerCase()
  return hay.includes(q.toLowerCase())
}

async function listPublished(db: Database): Promise<ListedPerson[]> {
  const result = await db.prepare(LIST_SQL).all<RawListed>()
  return (result.results ?? []).map(fromRaw)
}

export async function handleDesignationStatus(data: { mir: string; q: string }) {
  const access = await gateDesignation('view')
  if (!access.ok) return access
  const all = await listPublished(access.db)
  const counts: DesignationCounts = {
    published: all.length,
    numbered: all.filter((row) => row.number != null).length,
    generated: all.filter((row) => row.generatedAt).length,
    signed: all.filter((row) => row.signedAt).length,
    missing: all.filter((row) => !row.signedAt).length,
  }
  const mirsMap = new Map<string, number>()
  for (const row of all) {
    const code = mirFromSection(row.section)
    if (!code) continue
    mirsMap.set(code, (mirsMap.get(code) ?? 0) + 1)
  }
  const mirs: DesignationMirOption[] = [...mirsMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => ({ code, label: mirLabel(code) || `${code} ${ELECTION_DISTRICTS[code] ?? ''}`.trim(), count }))
  const people = all.filter((row) => matchesFilter(row, data.mir, data.q)).map(toView)
  const zipEligible = people.filter((row) => row.number != null).length
  return {
    ok: true as const,
    counts,
    people,
    mirs,
    zipEligible,
    zipBatchLimit: DESIGNATION_ZIP_BATCH_LIMIT,
  }
}

export async function handleDesignationNumber() {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) return access
  const listed = await listPublished(access.db)
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
  const toAssign = ordered.filter((row) => row.number == null && designationMirOf(row.section))
  const assignStatements = toAssign.map((row) =>
    access.db.prepare(DESIGNATION_ASSIGN_SQL).bind(designationMirOf(row.section), issuedOn, now, row.id),
  )
  const dateStatements = ordered
    .filter((row) => row.number != null && !row.issuedAt)
    .map((row) =>
      access.db
        .prepare('UPDATE signups SET designation_issued_at = ?, updated_at = ? WHERE id = ? AND designation_issued_at IS NULL')
        .bind(issuedOn, now, row.id),
    )
  await runSqlBatches(access.db, [...assignStatements, ...dateStatements])
  const assigned = toAssign.length
  return {
    ok: true as const,
    assigned,
    updated: assigned + dateStatements.length,
    message: assigned === 0 ? 'Всички с публикувана секция вече имат номер.' : `Номерирани ${assigned} души.`,
  }
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

/** People per Brevo resync call; each costs one or two Brevo subrequests. */
export const DESIGNATION_BREVO_PAGE = 100

export type DesignationSyncInput = { personIds: string[]; allSigned: boolean; offset: number }

export async function handleDesignationSyncBrevo(data: DesignationSyncInput) {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) return access
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
    const count = await access.db
      .prepare(`SELECT COUNT(*) AS n FROM signups WHERE COALESCE(designation_pdf_url, '') <> ''`)
      .first<{ n: number }>()
    total = Number(count?.n ?? 0)
    const page = await access.db
      .prepare(
        `SELECT id, email, designation_pdf_url AS url FROM signups WHERE COALESCE(designation_pdf_url, '') <> '' ORDER BY id LIMIT ? OFFSET ?`,
      )
      .bind(DESIGNATION_BREVO_PAGE, data.offset)
      .all<{ id: string; email: string; url: string }>()
    rows = page.results ?? []
  } else {
    const marks = data.personIds.map(() => '?').join(', ')
    const found = await access.db
      .prepare(`SELECT id, email, COALESCE(designation_pdf_url, '') AS url FROM signups WHERE id IN (${marks})`)
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
    if (!email) results.push({ personId: row.id, ok: false, error: 'няма имейл' })
    else if (!url) results.push({ personId: row.id, ok: false, error: 'няма линк към Drive' })
    else contacts.push({ personId: row.id, email, url })
  }
  const nextOffset = data.allSigned && data.offset + rows.length < total ? data.offset + rows.length : null
  if (contacts.length > 0) {
    try {
      const sync = await syncDesignationLinks({ apiKey: config.apiKey, listId: config.listId, attribute, contacts })
      results.push(...sync.results)
    } catch (error) {
      const message = errorMessage(error)
      console.error('designation brevo sync failed', JSON.stringify({ attribute, contacts: contacts.length, message }))
      return { ok: false as const, attribute, total, results, nextOffset, message: `Brevo: ${message}` }
    }
  }
  const failed = results.filter((row) => !row.ok)
  const updated = results.length - failed.length
  // Counts only, no emails: shows in Workers Logs whether a sync ran and what Brevo answered.
  const log = failed.length > 0 ? console.warn : console.info
  log('designation brevo sync', JSON.stringify({ attribute, updated, failed: failed.length, total, offset: data.offset, firstError: failed[0]?.error ?? null }))
  return {
    ok: failed.length === 0,
    attribute,
    updated,
    failed: failed.length,
    total,
    results,
    nextOffset,
    message: designationBrevoMessage(attribute, updated, failed),
  }
}

export type SignedLinkBrevo =
  | { ok: true; attribute: string; created?: boolean }
  | { ok: false; attribute: string; skipped?: boolean; error: string }

/**
 * Right after a signed upload: put the new Drive link on the person's Brevo contact.
 * The Drive link is already in D1, so a Brevo failure here never fails the upload;
 * „Синхронизирай с Brevo“ re-sends it later.
 */
export async function syncSignedLinkToBrevo(person: { id: string; email: string; url: string }): Promise<SignedLinkBrevo> {
  const attribute = configFromEnv(workerEnv()).brevoAttribute.trim().toUpperCase()
  const config = readBrevoConfig()
  if ('missing' in config) return { ok: false, attribute, skipped: true, error: 'липсва BREVO_API_KEY' }
  const email = person.email.trim()
  if (!email) return { ok: false, attribute, error: 'няма имейл' }
  const result = await pushDesignationLink({
    apiKey: config.apiKey,
    listId: config.listId,
    attribute,
    contact: { personId: person.id, email, url: person.url },
  })
  if (!result.ok) {
    console.warn('designation upload brevo failed', JSON.stringify({ attribute, error: result.error ?? null }))
    return { ok: false, attribute, error: result.error ?? 'Brevo повикването се провали.' }
  }
  return { ok: true, attribute, created: result.created }
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

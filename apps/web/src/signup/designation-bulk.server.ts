import { getCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { BrevoApiError, fetchBrevoProcess, importContactsToList, readBrevoConfig, type BrevoConfig } from './brevo'
import { brevoProcessReport, chunkContacts, type BrevoImportContact, type BrevoProcessReport } from './brevo-sync'
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
import { parseStoredNumber, planDesignationNumbering } from './designation-number'
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
  const maxRow = await access.db.prepare('SELECT MAX(designation_number) AS n FROM signups').first<{ n: number | string | null }>()
  const existingMax = parseStoredNumber(maxRow?.n) ?? 0
  const issuedOn = todayInSofia()
  const plan = planDesignationNumbering(
    listed.map((row) => ({
      id: row.id,
      publishedSection: row.section,
      createdAt: row.createdAt,
      number: row.number,
      issuedAt: row.issuedAt,
    })),
    existingMax,
    issuedOn,
  )
  const now = new Date().toISOString()
  const statements = plan.updates.map((row) =>
    access.db
      .prepare('UPDATE signups SET designation_number = ?, designation_issued_at = ?, updated_at = ? WHERE id = ?')
      .bind(row.number, row.issuedAt, now, row.id),
  )
  await runSqlBatches(access.db, statements)
  return {
    ok: true as const,
    assigned: plan.assigned,
    updated: plan.updates.length,
    message: plan.assigned === 0 ? 'Всички с публикувана секция вече имат номер.' : `Номерирани ${plan.assigned} души.`,
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
    message: designationHealthMessage(health),
  }
}

export async function handleDesignationSyncBrevo(data: { personIds: string[] }) {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) return access
  if (data.personIds.length === 0) return { ok: false as const, message: 'Няма хора за синхрон към Brevo.' }
  const config = readBrevoConfig()
  if ('missing' in config) {
    return {
      ok: false as const,
      skipped: true as const,
      message: 'Липсва BREVO_API_KEY. Линковете в Drive са записани.',
    }
  }
  if (!config.listId) {
    return {
      ok: false as const,
      skipped: true as const,
      message: 'Липсва BREVO_LIST_ID. Линковете в Drive са записани.',
    }
  }
  const marks = data.personIds.map(() => '?').join(', ')
  const rows = await access.db
    .prepare(`SELECT id, email, COALESCE(designation_pdf_url, '') AS url FROM signups WHERE id IN (${marks})`)
    .bind(...data.personIds)
    .all<{ id: string; email: string; url: string }>()
  const attribute = configFromEnv(workerEnv()).brevoAttribute
  const contacts: BrevoImportContact[] = []
  for (const row of rows.results ?? []) {
    const email = (row.email ?? '').trim()
    const url = (row.url ?? '').trim()
    if (!email || !url) continue
    contacts.push({ email, attributes: { [attribute]: url } })
  }
  if (contacts.length === 0) {
    return { ok: false as const, message: 'Няма URL-и за пращане към Brevo.' }
  }
  try {
    const processIds: Array<string | number> = []
    const errors: string[] = []
    let sent = 0
    for (const [index, batch] of chunkContacts(contacts).entries()) {
      try {
        const result = await importContactsToList(config, batch, config.listId)
        const processId = extractProcessId(result)
        if (processId !== null) processIds.push(processId)
        sent += batch.length
      } catch (error) {
        errors.push(`Партида ${index + 1}: ${errorMessage(error)}`)
      }
    }
    const processReports = await waitForProcesses(config, processIds)
    const rejected = processReports.flatMap((report) => report.issues.map((issue) => `Процес ${report.id}: ${issue}`))
    const pending = processReports.filter((report) => report.status !== 'completed').map((report) => `${report.id} (${report.status})`)
    return {
      ok: true as const,
      sent,
      rejected,
      pending,
      errors,
      processReports,
      message:
        errors.length === 0
          ? `Brevo: обновени ${sent} контакта (${attribute}).`
          : `Brevo: обновени ${sent} контакта; ${errors.length} партиди с грешка.`,
    }
  } catch (error) {
    return { ok: false as const, message: errorMessage(error) }
  }
}

async function waitForProcesses(config: BrevoConfig, processIds: Array<string | number>): Promise<BrevoProcessReport[]> {
  const reports: BrevoProcessReport[] = []
  for (const id of processIds.slice(0, 10)) {
    let report: BrevoProcessReport = { id, status: 'unknown', issues: [] }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      try {
        report = brevoProcessReport(id, await fetchBrevoProcess(config, id))
      } catch (error) {
        report = { id, status: 'unknown', issues: [errorMessage(error)] }
        break
      }
      if (report.status === 'completed') break
    }
    reports.push(report)
  }
  return reports
}

function extractProcessId(result: unknown): string | number | null {
  if (!result || typeof result !== 'object') return null
  const bag = result as { processId?: unknown; id?: unknown }
  if (typeof bag.processId === 'string' || typeof bag.processId === 'number') return bag.processId
  if (typeof bag.id === 'string' || typeof bag.id === 'number') return bag.id
  return null
}

function errorMessage(error: unknown) {
  if (error instanceof BrevoApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Brevo повикването се провали.'
}

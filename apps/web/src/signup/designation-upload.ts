import {
  createDriveClient,
  designationDriveFolderId,
  tryReadDriveAuth,
} from './designation-drive-core'
import { gateDesignation, syncSignedLinkToBrevo, workerEnv, type SignedLinkBrevo } from './designation-bulk.server'
import { bulkDesignationSignedFilename, isPdfBytes, personIdOk } from './designation-files'
import { parseStoredNumber } from './designation-number'
import { httpStatusForStaffDenial, namesFromPayload } from './designation-preview'
import { PARTNER_DESIGNATION_COLUMNS, isPartnerPersonId } from './partner-people-sql'
import { SIGNED_WAVE_SET_SQL } from './signed-waves-sql'
import { SIGNUP_DESIGNATION_SECTION_SQL } from './designation-section-sql'
import { describeUploadError, isTransientMessage } from './designation-upload-errors'
import { HISTORY_INSERT_SQL, HISTORY_REPLACED_SQL, designationLinkBrevoEligible, ensureIdentityFixTables } from './identity-fix'

/** Drive simple/multipart uploads (uploadType=multipart|media) take at most 5 MB; signed PDFs are ~170 KB. */
export const MAX_SIGNED_PDF_BYTES = 5 * 1024 * 1024
const MAX_BYTES = MAX_SIGNED_PDF_BYTES

interface UploadRow {
  id: string
  email: string | null
  payload: string
  published_section: string | null
  designation_number: number | string | null
  designation_drive_file_id: string | null
  designation_pdf_url: string | null
  designation_signed_at: string | null
  designation_mir: string | null
  withdrawn: number | null
}

/**
 * Never lets a throw escape: TanStack/h3 would answer `{ message: "HTTPError" }` (what an admin saw
 * when D1 dropped the connection during the staff check). Every failure is JSON with a Bulgarian
 * reason and `retryable`, so the page can retry with backoff and offer „Опитай пак“.
 */
export async function serveDesignationUpload(request: Request): Promise<Response> {
  try {
    return await handleDesignationUpload(request)
  } catch (error) {
    const failure = describeUploadError(error)
    console.warn('designation upload failed', failure.message)
    return json({ ok: false, message: failure.message, retryable: failure.retryable }, failure.status)
  }
}

/** D1 sometimes drops a connection („Network connection lost“): retry those, rethrow the rest. */
export async function retryTransient<T>(run: () => Promise<T>, delays: readonly number[] = [250, 750, 1500]): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      const transient = isTransientMessage(error instanceof Error ? error.message : String(error))
      if (!transient || attempt >= delays.length) throw error
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
    }
  }
}

/** The staff check reads D1 first; short retries ride out a dropped D1 connection. */
function gateWithRetry() {
  return retryTransient(() => gateDesignation('exportCampaign'))
}

async function handleDesignationUpload(request: Request): Promise<Response> {
  const access = await gateWithRetry()
  if (!access.ok) {
    return json({ ok: false, message: access.message }, httpStatusForStaffDenial(access.state))
  }
  const params = new URL(request.url).searchParams
  const personId = params.get('personId') ?? ''
  // Whole-ZIP re-uploads send ifMissing=1: someone who already has a signed file is skipped, not replaced.
  const ifMissing = params.get('ifMissing') === '1'
  if (!personIdOk(personId)) return json({ ok: false, message: 'Няма такъв човек.' }, 400)
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) return json({ ok: false, message: 'Файлът е над 5 MB (лимит на Google Drive за това качване).' }, 413)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) return json({ ok: false, message: 'Файлът е над 5 MB (лимит на Google Drive за това качване).' }, 413)
  if (!isPdfBytes(bytes)) return json({ ok: false, message: 'Файлът трябва да започва с %PDF-.' }, 400)

  const partner = isPartnerPersonId(personId)
  const row = await access.db
    .prepare(
      partner
        ? `SELECT ${PARTNER_DESIGNATION_COLUMNS}, email, designation_drive_file_id, designation_pdf_url, designation_signed_at,
        COALESCE(designation_mir, '') AS designation_mir, CASE WHEN withdrawn_at IS NULL THEN 0 ELSE 1 END AS withdrawn FROM partner_people WHERE id = ?`
        : `SELECT id, email, payload, ${SIGNUP_DESIGNATION_SECTION_SQL} AS published_section,
        designation_number, designation_drive_file_id, designation_pdf_url, designation_signed_at,
        COALESCE(designation_mir, '') AS designation_mir, COALESCE(withdrawn, 0) AS withdrawn
        FROM signups WHERE id = ?`,
    )
    .bind(personId)
    .first<UploadRow>()
  if (!row) return json({ ok: false, message: 'Няма такъв човек.' }, 404)
  const section = (row.published_section ?? '').trim()
  if (!section) return json({ ok: false, message: 'Няма назначена секция за това пълномощно.' }, 400)
  const number = parseStoredNumber(row.designation_number)
  if (number == null) return json({ ok: false, message: 'Човекът още няма номер.' }, 400)

  const envBag = workerEnv()
  const auth = tryReadDriveAuth(envBag)
  const folderId = designationDriveFolderId(envBag)
  const stub = devStubDrive(personId)
  if (!stub && (!auth.ok || !folderId)) {
    return json({ ok: false, message: 'Липсват Google Drive данни. Качването е изключено.' }, 503)
  }

  const names = namesFromPayload(row.payload)
  const filename = bulkDesignationSignedFilename({ number, section, firstName: names.firstName, middleName: names.middleName, lastName: names.lastName })
  const existingId = (row.designation_drive_file_id ?? '').trim()
  const existingUrl = (row.designation_pdf_url ?? '').trim()
  const replaced = Boolean(existingId || existingUrl)
  if (ifMissing && replaced) {
    return json({ ok: true, skipped: true, url: existingUrl, fileId: existingId, replaced: false })
  }
  // Signed again after a fix or a rename (no signed mark, an old file still linked): the old file is
  // superseded, never overwritten, so it stays in Drive and in designation_file_history.
  const resigning = replaced && !(row.designation_signed_at ?? '').trim()
  const now = new Date().toISOString()
  const file = stub
    ? stub
    : await createDriveClient((auth as Extract<typeof auth, { ok: true }>).auth).uploadPdf({
        name: filename,
        bytes,
        folderId: folderId!,
        fileId: resigning ? undefined : existingId || undefined,
      })
  // The file is in Drive now: a dropped D1 connection here must not make the page upload it again
  // (that would leave a second copy in Drive), so the link write gets its own short retries.
  await retryTransient(() =>
    access.db
      .prepare(
        `UPDATE ${partner ? 'partner_people' : 'signups'} SET designation_pdf_url = ?, designation_drive_file_id = ?, ${SIGNED_WAVE_SET_SQL}, designation_signed_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(file.webViewLink, file.id, now, now, now, personId)
      .run(),
  )
  await recordReplacement(access.db, {
    personId,
    mir: (row.designation_mir ?? '').trim(),
    number,
    old: resigning ? { fileId: existingId, url: existingUrl } : null,
    file: { id: file.id, url: file.webViewLink },
    actor: access.email,
    now,
  })
  // „И аз“ partner people never reach Brevo: the link stays in D1 and Drive only.
  const eligible = designationLinkBrevoEligible({
    id: personId,
    partner,
    email: row.email ?? '',
    withdrawn: Number(row.withdrawn ?? 0) === 1,
    signed: true,
    url: file.webViewLink,
  })
  const brevo: SignedLinkBrevo | PartnerNoBrevo = partner
    ? PARTNER_NO_BREVO
    : !eligible.ok
      ? { ok: false, attribute: 'DOCUMENT_URL', skipped: true, error: eligible.reason === 'withdrawn' ? 'отписан' : 'няма имейл' }
      : stub
        ? { ok: false, attribute: 'DOCUMENT_URL', skipped: true, error: 'e2e: Brevo не се вика' }
        : await brevoAfterUpload({ id: personId, email: row.email ?? '', url: file.webViewLink }, access.db)
  return json({ ok: true, url: file.webViewLink, replaced, resigned: resigning, fileId: file.id, brevo })
}

/**
 * The file history after a signed upload. A re-sign whose old file was still linked (a rename)
 * gets its superseded row here; every open superseded row of the person (a „Поправи име/ЕГН“
 * reset wrote one) now points at the new file. Never fails the upload: the link is already saved.
 */
async function recordReplacement(
  db: Parameters<typeof ensureIdentityFixTables>[0],
  input: { personId: string; mir: string; number: number; old: { fileId: string; url: string } | null; file: { id: string; url: string }; actor: string; now: string },
) {
  try {
    await ensureIdentityFixTables(db)
    const statements: ReturnType<typeof db.prepare>[] = []
    if (input.old && (input.old.fileId || input.old.url)) {
      statements.push(
        db
          .prepare(HISTORY_INSERT_SQL)
          .bind(crypto.randomUUID(), input.personId, input.mir, input.number, input.old.fileId, input.old.url, null, 'resign_upload', input.now, input.actor),
      )
    }
    statements.push(db.prepare(HISTORY_REPLACED_SQL).bind(input.file.id, input.file.url, input.now, input.personId))
    await retryTransient(() => db.batch(statements))
  } catch (error) {
    console.warn('designation file history not written', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Local e2e only: in `vite dev`, people whose id starts with e2e- get a stub Drive file
 * (e2e-stub-…, served by the profile's dev stub) and Drive is never called. Off in every build.
 */
function devStubDrive(personId: string): { id: string; webViewLink: string } | null {
  if (!import.meta.env.DEV || !personId.startsWith('e2e-')) return null
  const id = `e2e-stub-${personId}-${Date.now().toString(36)}`
  return { id, webViewLink: `https://drive.google.com/file/d/${id}/view` }
}

export type PartnerNoBrevo = { ok: true; attribute: string; partner: true }
export const PARTNER_NO_BREVO: PartnerNoBrevo = { ok: true, attribute: 'DOCUMENT_URL', partner: true }

/** The signed link goes to Brevo with the upload itself; a Brevo failure is reported, never thrown. */
async function brevoAfterUpload(person: { id: string; email: string; url: string }, db: Parameters<typeof syncSignedLinkToBrevo>[1]): Promise<SignedLinkBrevo> {
  try {
    return await syncSignedLinkToBrevo(person, db)
  } catch (error) {
    return { ok: false, attribute: 'DOCUMENT_URL', error: error instanceof Error ? error.message : 'Brevo повикването се провали.' }
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}

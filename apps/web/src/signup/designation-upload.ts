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
import { describeUploadError, isTransientMessage } from './designation-upload-errors'

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
        ? `SELECT ${PARTNER_DESIGNATION_COLUMNS}, email, designation_drive_file_id, designation_pdf_url FROM partner_people WHERE id = ?`
        : `SELECT id, email, payload, COALESCE(published_section, '') AS published_section,
        designation_number, designation_drive_file_id, designation_pdf_url
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
  if (!auth.ok || !folderId) {
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
  const client = createDriveClient(auth.auth)
  const file = await client.uploadPdf({
    name: filename,
    bytes,
    folderId,
    fileId: existingId || undefined,
  })
  const now = new Date().toISOString()
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
  // „И аз“ partner people never reach Brevo: the link stays in D1 and Drive only.
  const brevo: SignedLinkBrevo | PartnerNoBrevo = partner
    ? PARTNER_NO_BREVO
    : await brevoAfterUpload({ id: personId, email: row.email ?? '', url: file.webViewLink }, access.db)
  return json({ ok: true, url: file.webViewLink, replaced, fileId: file.id, brevo })
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

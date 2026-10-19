import {
  createDriveClient,
  designationDriveFolderId,
  tryReadDriveAuth,
} from './designation-drive-core'
import { gateDesignation, workerEnv } from './designation-bulk.server'
import { bulkDesignationSignedFilename, isPdfBytes, personIdOk } from './designation-files'
import { parseStoredNumber } from './designation-number'
import { httpStatusForStaffDenial, namesFromPayload } from './designation-preview'

const MAX_BYTES = 15 * 1024 * 1024

interface UploadRow {
  id: string
  payload: string
  published_section: string | null
  designation_number: number | string | null
  designation_drive_file_id: string | null
  designation_pdf_url: string | null
}

export async function serveDesignationUpload(request: Request): Promise<Response> {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) {
    return json({ ok: false, message: access.message }, httpStatusForStaffDenial(access.state))
  }
  const personId = new URL(request.url).searchParams.get('personId') ?? ''
  if (!personIdOk(personId)) return json({ ok: false, message: 'Няма такъв човек.' }, 400)
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) return json({ ok: false, message: 'Файлът е над 15 MB.' }, 413)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) return json({ ok: false, message: 'Файлът е над 15 MB.' }, 413)
  if (!isPdfBytes(bytes)) return json({ ok: false, message: 'Файлът трябва да започва с %PDF-.' }, 400)

  const row = await access.db
    .prepare(
      `SELECT id, payload, COALESCE(published_section, '') AS published_section,
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
  const replaced = Boolean(existingId || (row.designation_pdf_url ?? '').trim())
  try {
    const client = createDriveClient(auth.auth)
    const file = await client.uploadPdf({
      name: filename,
      bytes,
      folderId,
      fileId: existingId || undefined,
    })
    const now = new Date().toISOString()
    await access.db
      .prepare(
        `UPDATE signups SET designation_pdf_url = ?, designation_drive_file_id = ?, designation_signed_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(file.webViewLink, file.id, now, now, personId)
      .run()
    return json({ ok: true, url: file.webViewLink, replaced, fileId: file.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Drive качването се провали.'
    return json({ ok: false, message }, 502)
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}

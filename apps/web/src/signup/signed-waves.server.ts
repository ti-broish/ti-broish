import { configFromEnv } from './designation-config'
import { gateDesignation, workerEnv } from './designation-bulk.server'
import { createDriveClient, tryReadDriveAuth } from './designation-drive-core'
import { httpStatusForStaffDenial } from './designation-preview'
import { streamZipWriter } from './designation-zip-stream'
import type { SignupD1 } from './db-core'
import {
  SIGNED_PEOPLE_SQL,
  peopleInWave,
  signedPersonFromRow,
  signedWaves,
  writeSignedWaveZip,
  type SignedPerson,
  type SignedRow,
  type SignedWave,
} from './signed-waves'

/** Workers allow ~1000 subrequests per request; one per PDF plus the Drive token. */
export const SIGNED_ZIP_PDF_LIMIT = 900

export async function loadSignedPeople(db: SignupD1): Promise<SignedPerson[]> {
  const result = await db.prepare(SIGNED_PEOPLE_SQL).all<SignedRow>()
  return (result.results ?? []).map(signedPersonFromRow).filter((person): person is SignedPerson => person != null)
}

export async function handleSignedWaves(): Promise<
  | { ok: true; waves: SignedWave[]; total: number; mirs: number; pdfLimit: number }
  | { ok: false; message: string }
> {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) return { ok: false, message: access.message }
  const people = await loadSignedPeople(access.db)
  return {
    ok: true,
    waves: signedWaves(people),
    total: people.length,
    mirs: new Set(people.map((person) => person.mir)).size,
    pdfLimit: SIGNED_ZIP_PDF_LIMIT,
  }
}

function text(message: string, status: number) {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

/**
 * GET /admin/palnomoshtni/podpisani?wave=YYYY-MM-DD|all[&tables=1]
 * One folder per РИК with „РИК NN Представители.xlsx“ and that РИК's signed PDFs from Drive.
 */
export async function serveSignedWaveZip(request: Request): Promise<Response> {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) return text(access.message, httpStatusForStaffDenial(access.state))
  const url = new URL(request.url)
  const wave = (url.searchParams.get('wave') ?? '').trim()
  if (wave !== 'all' && !/^\d{4}-\d{2}-\d{2}$/.test(wave)) return text('Вълната е дата (ГГГГ-ММ-ДД) или „all“.', 400)
  const tablesOnly = url.searchParams.get('tables') === '1'
  const all = await loadSignedPeople(access.db)
  const people = peopleInWave(all, wave)
  if (people.length === 0) return text('Няма подписани пълномощни в тази вълна.', 404)
  if (!tablesOnly && people.length > SIGNED_ZIP_PDF_LIMIT) {
    return text(`Над ${SIGNED_ZIP_PDF_LIMIT} PDF-а в един ZIP: свали по вълни или само таблиците.`, 400)
  }

  const envBag = workerEnv()
  const config = configFromEnv(envBag)
  const auth = tryReadDriveAuth(envBag)
  const client = !tablesOnly && auth.ok ? createDriveClient(auth.auth) : null
  const stream = streamZipWriter(async (add) => {
    await writeSignedWaveZip(add, {
      people,
      committeeFullName: config.committeeFullName,
      numberPrefix: config.numberPrefix,
      tablesOnly,
      fetchPdf: client ? (fileId) => client.downloadFile(fileId) : null,
    })
  })

  const waves = signedWaves(all)
  const number = waves.find((item) => item.key === wave)?.wave
  const name = wave === 'all' ? `podpisani-vsichki-${new Date().toISOString().slice(0, 10)}` : `podpisani-valna-${number ?? 0}-${wave}`
  const filename = `${name}${tablesOnly ? '-tablici' : ''}.zip`
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  })
}

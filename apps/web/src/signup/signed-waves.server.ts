import { configFromEnv } from './designation-config'
import { gateDesignation, workerEnv } from './designation-bulk.server'
import { createDriveClient, tryReadDriveAuth } from './designation-drive-core'
import { httpStatusForStaffDenial } from './designation-preview'
import { streamZipWriter } from './designation-zip-stream'
import type { SignupD1 } from './db-core'
import { ensureRenamesTable } from './designation-rename'
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
  const people = (result.results ?? []).map(signedPersonFromRow).filter((person): person is SignedPerson => person != null)
  const open = await openRikCorrections(db)
  return open.size ? people.map((person) => (open.has(person.id) ? { ...person, correctionFrom: open.get(person.id)! } : person)) : people
}

/** Renamed after the РИК got the old name, and the register does not show the new one yet: person id → old name. */
async function openRikCorrections(db: SignupD1) {
  const open = new Map<string, string>()
  try {
    await ensureRenamesTable(db)
    const rows = await db
      .prepare(
        `SELECT r.person_id, r.old_name FROM designation_renames r
         WHERE r.rik_correction = 1
           AND NOT EXISTS (SELECT 1 FROM rik_status s WHERE s.person_id = r.person_id AND s.status = 'registered')
         ORDER BY r.created_at`,
      )
      .all<{ person_id: string; old_name: string }>()
    for (const row of rows.results ?? []) if (!open.has(row.person_id)) open.set(row.person_id, row.old_name)
  } catch {
    // No rik_status table yet: no corrections to list.
  }
  return open
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

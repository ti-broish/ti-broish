import { configFromEnv } from './designation-config'
import { gateDesignation, workerEnv } from './designation-bulk.server'
import { createDriveClient, tryReadDriveAuth } from './designation-drive-core'
import { httpStatusForStaffDenial } from './designation-preview'
import { streamZipWriter } from './designation-zip-stream'
import type { SignupD1 } from './db-core'
import { ensureIdentityFixTables } from './identity-fix'
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
  return open.size ? people.map((person) => withCorrection(person, open.get(person.id))) : people
}

function withCorrection(person: SignedPerson, correction: OpenCorrection | undefined): SignedPerson {
  if (!correction) return person
  return {
    ...person,
    ...(correction.oldName ? { correctionFrom: correction.oldName } : {}),
    ...(correction.oldEgn ? { correctionEgnFrom: correction.oldEgn } : {}),
  }
}

export interface OpenCorrection {
  oldName: string
  oldEgn: string
}

/**
 * Open РИК corrections, person id → what the РИК has now. A name: until the register shows the
 * new one. An ЕГН (from „Поправи име/ЕГН“; the register never shows ЕГН): until a РИК task of the
 * person is marked done after the fix.
 */
export const OPEN_RIK_CORRECTIONS_SQL = `SELECT r.person_id, r.old_name, r.new_name, COALESCE(r.old_egn, '') AS old_egn FROM designation_renames r
  WHERE r.rik_correction = 1 AND (
    (r.old_name != r.new_name AND NOT EXISTS (SELECT 1 FROM rik_status s WHERE s.person_id = r.person_id AND s.status = 'registered'))
    OR (COALESCE(r.old_egn, '') != '' AND NOT EXISTS (SELECT 1 FROM rik_tasks t WHERE t.person_id = r.person_id AND t.done_at IS NOT NULL AND t.done_at > r.created_at))
  )
  ORDER BY r.created_at`

export function openCorrectionsFromRows(rows: Array<{ person_id: string; old_name: string; new_name: string; old_egn: string }>) {
  const open = new Map<string, OpenCorrection>()
  for (const row of rows) {
    const current = open.get(row.person_id) ?? { oldName: '', oldEgn: '' }
    // The first (oldest) value is what the РИК was sent.
    if (!current.oldName && row.old_name && row.old_name !== row.new_name) current.oldName = row.old_name
    if (!current.oldEgn && row.old_egn) current.oldEgn = row.old_egn
    if (current.oldName || current.oldEgn) open.set(row.person_id, current)
  }
  return open
}

async function openRikCorrections(db: SignupD1) {
  try {
    await ensureIdentityFixTables(db)
    const rows = await db.prepare(OPEN_RIK_CORRECTIONS_SQL).all<{ person_id: string; old_name: string; new_name: string; old_egn: string }>()
    return openCorrectionsFromRows(rows.results ?? [])
  } catch {
    // No rik_status / rik_tasks table yet: no corrections to list.
    return new Map<string, OpenCorrection>()
  }
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

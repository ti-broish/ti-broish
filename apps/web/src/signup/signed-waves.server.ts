import { configFromEnv } from './designation-config'
import { gateDesignation, workerEnv } from './designation-bulk.server'
import { createDriveClient, tryReadDriveAuth } from './designation-drive-core'
import { httpStatusForStaffDenial } from './designation-preview'
import { streamZipWriter } from './designation-zip-stream'
import type { SignupD1 } from './db-core'
import { ensureIdentityFixTables } from './identity-fix'
import { CLOSED_WAVES_SQL, CLOSE_WAVE_SQL } from './signed-waves-sql'
import {
  WAVE_PEOPLE_SQL,
  peopleInWave,
  signedPersonFromRow,
  signedWaves,
  writeSignedWaveZip,
  type ClosedWaveRow,
  type SignedPerson,
  type SignedRow,
  type SignedWave,
} from './signed-waves'

/** Workers allow ~1000 subrequests per request; one per PDF plus the Drive token. */
export const SIGNED_ZIP_PDF_LIMIT = 900

/** Everyone numbered (signed or not) with their wave; the ZIP keeps only the signed ones. */
export async function loadWavePeople(db: SignupD1): Promise<SignedPerson[]> {
  const result = await db.prepare(WAVE_PEOPLE_SQL).all<SignedRow>()
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

export async function loadClosedWaves(db: SignupD1): Promise<ClosedWaveRow[]> {
  const result = await db.prepare(CLOSED_WAVES_SQL).all<ClosedWaveRow>()
  return result.results ?? []
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
  const [people, closed] = await Promise.all([loadWavePeople(access.db), loadClosedWaves(access.db)])
  const signed = people.filter((person) => person.signed)
  return {
    ok: true,
    waves: signedWaves(people, closed),
    total: signed.length,
    mirs: new Set(signed.map((person) => person.mir)).size,
    pdfLimit: SIGNED_ZIP_PDF_LIMIT,
  }
}

/**
 * „Изпратена на РИК“: closes the open wave of one PDF date. Everyone numbered with that date and
 * no wave yet joins the new closed wave; later numbers with the same date make the next wave.
 */
export async function handleCloseSigningWave(issueDate: string): Promise<{ ok: true; closed: number; waveId: string } | { ok: false; message: string }> {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) return { ok: false, message: access.message }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return { ok: false, message: 'Вълната е дата (ГГГГ-ММ-ДД).' }
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await access.db.batch([
    access.db.prepare(CLOSE_WAVE_SQL[0]!).bind(id, issueDate, now, access.email),
    access.db.prepare(CLOSE_WAVE_SQL[1]!).bind(id, issueDate),
    access.db.prepare(CLOSE_WAVE_SQL[2]!).bind(id, issueDate),
  ])
  // Counted after the batch: D1's meta.changes also counts rows the high-water triggers touch.
  const row = await access.db
    .prepare('SELECT (SELECT COUNT(*) FROM signups WHERE designation_wave_id = ?1) + (SELECT COUNT(*) FROM partner_people WHERE designation_wave_id = ?1) AS n')
    .bind(id)
    .first<{ n: number }>()
  const closed = Number(row?.n ?? 0)
  if (closed === 0) return { ok: false, message: 'Няма отворена вълна за тази дата.' }
  return { ok: true, closed, waveId: id }
}

function text(message: string, status: number) {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

/**
 * GET /admin/palnomoshtni/podpisani?wave=<closed wave id>|YYYY-MM-DD (open wave of that PDF date)|all[&tables=1]
 * One folder per РИК with „РИК NN Представители.xlsx“ and that РИК's signed PDFs from Drive.
 */
export async function serveSignedWaveZip(request: Request): Promise<Response> {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) return text(access.message, httpStatusForStaffDenial(access.state))
  const url = new URL(request.url)
  const wave = (url.searchParams.get('wave') ?? '').trim()
  if (wave !== 'all' && !/^[\w-]{1,64}$/.test(wave)) return text('Вълната е дата (ГГГГ-ММ-ДД), номер на затворена вълна или „all“.', 400)
  const tablesOnly = url.searchParams.get('tables') === '1'
  const [all, closed] = await Promise.all([loadWavePeople(access.db), loadClosedWaves(access.db)])
  const people = peopleInWave(all, wave, closed)
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

  const found = signedWaves(all, closed).find((item) => item.key === wave)
  const name = wave === 'all' ? `podpisani-vsichki-${new Date().toISOString().slice(0, 10)}` : `podpisani-valna-${found?.wave ?? 0}-${found?.issueKey ?? wave}`
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

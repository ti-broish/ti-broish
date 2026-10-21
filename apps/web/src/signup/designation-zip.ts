import { todayInSofia } from './designation-config'
import { gateDesignation, workerEnv } from './designation-bulk.server'
import {
  DESIGNATION_ZIP_BATCH_LIMIT,
  bulkDesignationFilename,
  bulkManifestRow,
  personIdOk,
  serializeBulkManifestCsv,
  type DesignationFilePerson,
} from './designation-files'
import { registerWorkerDesignationFonts } from './designation-fonts-worker'
import { parseStoredNumber } from './designation-number'
import { httpStatusForStaffDenial, namesFromPayload, previewDesignationPdf, previewNumber } from './designation-preview'
import { runSqlBatches } from './designation-sql'
import { PARTNER_DESIGNATION_COLUMNS, isPartnerPersonId } from './partner-people-sql'
import { streamZipWriter } from './designation-zip-stream'
import { parseSignScope, signScopeWhere } from './designation-sign-scope'
import { partnerDuplicateSql, signupDuplicateSql } from './designation-duplicates'

registerWorkerDesignationFonts()

export { collectStream, streamStoredZip, streamZipWriter } from './designation-zip-stream'

interface ZipRow {
  id: string
  payload: string
  egn: string | null
  published_section: string | null
  section_place: string | null
  designation_number: number | string | null
  designation_issued_at: string | null
}

export async function serveDesignationZip(request: Request): Promise<Response> {
  const access = await gateDesignation('exportCampaign')
  if (!access.ok) {
    return new Response(access.message, {
      status: httpStatusForStaffDenial(access.state),
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  const url = new URL(request.url)
  const mir = (url.searchParams.get('mir') ?? '').trim()
  if (mir && !/^\d{1,2}$/.test(mir)) {
    return new Response('МИР трябва да е едно или две цифри.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const asked = Number(url.searchParams.get('limit') ?? DESIGNATION_ZIP_BATCH_LIMIT) || DESIGNATION_ZIP_BATCH_LIMIT
  const limit = Math.min(DESIGNATION_ZIP_BATCH_LIMIT, Math.max(1, Math.floor(asked)))
  const mirDigits = mir.padStart(2, '0')
  // ?partner=1: only „И аз“ partner people, for printing them apart.
  const onlyPartner = url.searchParams.get('partner') === '1'
  // ?scope=new|unsigned|all (default all). „new“ shrinks as ZIPs mark people, so it always reads from 0.
  const scope = parseSignScope(url.searchParams.get('scope'))
  const scopeWhere = signScopeWhere(scope)
  const from0 = scope === 'new' ? 0 : offset
  // Signups with a published section plus „И аз“ partner people with a МИР, in one numbered list.
  // Never a withdrawn „И аз“ row or a duplicate (same ЕГН holds another number): one person, one пълномощно.
  const rows = await access.db
    .prepare(
      `SELECT * FROM (
        SELECT id, payload, egn,
          COALESCE(published_section, '') AS published_section,
          COALESCE(NULLIF(section_place, ''), json_extract(payload, '$.place.sectionPlace'), '') AS section_place,
          designation_number, designation_issued_at
          FROM signups
          WHERE COALESCE(published_section, '') != ''
            AND designation_number IS NOT NULL
            AND COALESCE(withdrawn, 0) = 0
            AND (?1 = '' OR substr(published_section, 1, 2) = ?1)
            AND ?4 = 0
            AND ${scopeWhere}
            AND NOT ${signupDuplicateSql('signups')}
        UNION ALL
        SELECT ${PARTNER_DESIGNATION_COLUMNS}
          FROM partner_people
          WHERE COALESCE(designation_mir, '') != ''
            AND designation_number IS NOT NULL
            AND (?1 = '' OR designation_mir = ?1)
            AND ${scopeWhere}
            AND withdrawn_at IS NULL
            AND NOT ${partnerDuplicateSql('partner_people')}
      )
        ORDER BY designation_number, id
        LIMIT ?2 OFFSET ?3`,
    )
    .bind(mir ? mirDigits : '', limit, from0, onlyPartner ? 1 : 0)
    .all<ZipRow>()
  const people = rows.results ?? []
  if (people.length === 0) {
    const empty = scope === 'new' ? 'Няма нови номерирани за подпис (всички са подписани или вече свалени).' : 'Няма номерирани хора за тази партида.'
    return new Response(empty, {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  const envBag = workerEnv()
  const manifestPeople: DesignationFilePerson[] = []
  const ids: string[] = []
  const stream = streamZipWriter(async (add) => {
    for (const row of people) {
      if (!personIdOk(row.id)) continue
      const names = namesFromPayload(row.payload)
      const number = parseStoredNumber(row.designation_number)
      if (number == null) continue
      const section = (row.published_section ?? '').trim()
      if (!section) continue
      const { bytes } = await previewDesignationPdf({
        person: {
          firstName: names.firstName,
          middleName: names.middleName,
          lastName: names.lastName,
          egn: (row.egn ?? '').trim(),
          sectionCode: section,
          sectionPlace: (row.section_place ?? '').trim(),
        },
        number: previewNumber(row.designation_number),
        issuedOn: (row.designation_issued_at ?? '').trim() || todayInSofia(),
        env: envBag,
      })
      const filePerson: DesignationFilePerson = {
        id: row.id,
        number,
        section,
        firstName: names.firstName,
        middleName: names.middleName,
        lastName: names.lastName,
        name: [names.firstName, names.middleName, names.lastName].filter(Boolean).join(' '),
        hasDriveFile: false,
        ...(isPartnerPersonId(row.id) ? { partner: 'iaz.bg' } : {}),
      }
      await add(bulkDesignationFilename(filePerson), bytes)
      manifestPeople.push(filePerson)
      ids.push(row.id)
    }
    if (manifestPeople.length === 0) throw new Error('Няма номерирани хора за тази партида.')
    const manifest = serializeBulkManifestCsv(manifestPeople.map(bulkManifestRow))
    await add('manifest.csv', new TextEncoder().encode(manifest))
    const now = new Date().toISOString()
    const statements = ids.map((id) =>
      access.db
        .prepare(`UPDATE ${isPartnerPersonId(id) ? 'partner_people' : 'signups'} SET designation_generated_at = ?, designation_signing_generated_at = ?, updated_at = ? WHERE id = ?`)
        .bind(now, now, now, id),
    )
    await runSqlBatches(access.db, statements)
  })

  const from = from0 + 1
  const to = from0 + people.length
  const scopePart = scope === 'new' ? '-novi' : scope === 'unsigned' ? '-bez-podpis' : ''
  const mirPart = `${onlyPartner ? '-i-az' : ''}${mir ? `-mir${mirDigits}` : ''}${scopePart}`
  const filename = `palnomoshtni${mirPart}-${String(from).padStart(4, '0')}-${String(to).padStart(4, '0')}.zip`
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  })
}

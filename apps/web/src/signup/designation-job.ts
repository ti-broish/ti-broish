import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  configFromEnv,
  formatBgDate,
  formatDesignationNumber,
  grantorFromEnv,
  todayInSofia,
  type DesignationConfig,
} from './designation-config'
import type { DriveClient } from './designation-drive'
import { updateBrevoContactAttribute } from './designation-brevo'
import { hasRealEmail } from './no-email'
import {
  serializeManifestCsv,
  serializeManifestJson,
  sortManifest,
  type ManifestRow,
} from './designation-import'
import { designationMirOf, nextDesignationNumber, parseStoredNumber } from './designation-number'
import { bulkDesignationFilename } from './designation-files'
import { renderDesignationPdf } from './designation-pdf'
import type { DesignationGrantor, DesignationPersonInput } from './designation-text'

export { configFromEnv, grantorFromEnv }

export interface DesignationPersonRow {
  id: string
  email: string
  firstName: string
  middleName: string
  lastName: string
  egn: string
  sectionCode: string
  sectionPlace: string
  designationNumber: number | null
  /** МИР stored with the number, when the row already has one. */
  designationMir?: string | null
  designationIssuedAt: string | null
  designationPdfUrl: string | null
  designationDriveFileId: string | null
}

export interface DesignationSave {
  id: string
  mir: string
  number: number
  issuedAt: string
  pdfUrl: string | null
  driveFileId: string | null
}

export interface DesignationDataSource {
  list(opts: { personId?: string; limit?: number }): Promise<DesignationPersonRow[]>
  /** Stored maximum number per МИР. */
  maxNumbers(): Promise<ReadonlyMap<string, number>>
  save(row: DesignationSave): Promise<void>
}

export interface DesignationJobOptions {
  outDir: string
  dryRun: boolean
  localOnly: boolean
  force: boolean
  personId?: string
  limit?: number
  concurrency: number
}

export interface DesignationJobDeps {
  data: DesignationDataSource
  config: DesignationConfig
  grantor: DesignationGrantor
  issuedOn: string
  drive?: DriveClient | null
  folderId?: string
  brevoApiKey?: string
  log?: (line: string) => void
  now?: Date
  render?: typeof renderDesignationPdf
}

export interface DesignationJobSummary {
  total: number
  generated: number
  uploaded: number
  skipped: number
  failed: number
  errors: string[]
}

export function samplePerson(): DesignationPersonRow {
  return {
    id: 'sample',
    email: 'ivan.sample@example.com',
    firstName: 'Иван',
    middleName: 'Петров',
    lastName: 'Иванов',
    egn: '0000000000',
    sectionCode: '234600001',
    sectionPlace: 'гр. София, район Младост, ул. Примерна 1',
    designationNumber: 501,
    designationIssuedAt: null,
    designationPdfUrl: null,
    designationDriveFileId: null,
  }
}

export async function runSamplePdf(opts: {
  outPath: string
  config: DesignationConfig
  grantor: DesignationGrantor
  issuedOn: string
  person?: DesignationPersonInput
}) {
  const person = opts.person ?? {
    firstName: 'Иван',
    middleName: 'Петров',
    lastName: 'Иванов',
    egn: '0000000000',
    sectionCode: '234600001',
    sectionPlace: 'гр. София, район Младост, ул. Примерна 1',
  }
  const bytes = await renderDesignationPdf(
    {
      number: 501,
      issuedOn: opts.issuedOn,
      grantor: opts.grantor,
      person,
    },
    opts.config,
  )
  await writeFile(opts.outPath, bytes)
  return bytes
}

interface AssignedPerson {
  person: DesignationPersonRow
  mir: string
  number: number
  issuedAt: string
}

export async function runDesignationJob(opts: DesignationJobOptions, deps: DesignationJobDeps): Promise<DesignationJobSummary> {
  const log = deps.log ?? (() => undefined)
  const render = deps.render ?? renderDesignationPdf
  const issuedOn = formatBgDate(deps.issuedOn || todayInSofia(deps.now))
  const people = await deps.data.list({ personId: opts.personId, limit: opts.limit })
  const summary: DesignationJobSummary = { total: people.length, generated: 0, uploaded: 0, skipped: 0, failed: 0, errors: [] }
  // Consecutive per МИР from 501; the unique (designation_mir, designation_number) index rejects a clash.
  const stored = await deps.data.maxNumbers()
  const next = new Map<string, number>()
  const mirOf = (person: DesignationPersonRow) =>
    (person.designationNumber != null && person.designationMir?.trim()) || designationMirOf(person.sectionCode)
  const nextIn = (mir: string) => next.get(mir) ?? nextDesignationNumber([stored.get(mir)])
  for (const person of people) {
    const existing = parseStoredNumber(person.designationNumber)
    const mir = mirOf(person)
    if (existing != null && existing >= nextIn(mir)) next.set(mir, existing + 1)
  }
  const assigned: AssignedPerson[] = people.map((person) => {
    const mir = mirOf(person)
    let number = parseStoredNumber(person.designationNumber)
    if (number == null) {
      number = nextIn(mir)
      next.set(mir, number + 1)
    }
    return {
      person,
      mir,
      number,
      issuedAt: person.designationIssuedAt ? formatBgDate(person.designationIssuedAt) : issuedOn,
    }
  })
  if (!opts.dryRun) await mkdir(opts.outDir, { recursive: true })

  const queue = [...assigned]
  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      try {
        const result = await processPerson(item)
        if (result === 'skipped') summary.skipped += 1
        else {
          summary.generated += 1
          if (result === 'uploaded') summary.uploaded += 1
        }
      } catch (error) {
        summary.failed += 1
        const message = error instanceof Error ? error.message : 'неизвестна грешка'
        summary.errors.push(`${item.person.id}: ${message}`)
        log(`грешка ${item.person.id}: ${message}`)
      }
    }
  })
  await Promise.all(workers)
  if (!opts.dryRun && opts.localOnly) {
    const rows = sortManifest(assigned.map((item) => manifestRow(item, deps.config)))
    await writeFile(join(opts.outDir, 'manifest.csv'), serializeManifestCsv(rows))
    await writeFile(join(opts.outDir, 'manifest.json'), serializeManifestJson(rows))
    log(`записан манифест ${join(opts.outDir, 'manifest.csv')}`)
  }
  return summary

  async function processPerson(item: AssignedPerson): Promise<'skipped' | 'generated' | 'uploaded'> {
    const { person, mir, number, issuedAt } = item
    const display = formatDesignationNumber(number, deps.config.numberPrefix)
    const name = [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ')
    const filename = bulkDesignationFilename({
      number,
      section: person.sectionCode,
      firstName: person.firstName,
      middleName: person.middleName,
      lastName: person.lastName,
    })
    log(`план ${person.id} № ${display} ${name} секция ${person.sectionCode}`)
    if (opts.dryRun) return 'generated'

    const bytes = await render(
      {
        number,
        issuedOn: issuedAt,
        grantor: deps.grantor,
        person: {
          firstName: person.firstName,
          middleName: person.middleName,
          lastName: person.lastName,
          egn: person.egn,
          sectionCode: person.sectionCode,
          sectionPlace: person.sectionPlace,
        },
      },
      deps.config,
    )
    await writeFile(join(opts.outDir, filename), bytes)

    if (opts.localOnly) {
      await deps.data.save({ id: person.id, mir, number, issuedAt, pdfUrl: person.designationPdfUrl, driveFileId: person.designationDriveFileId })
      return 'generated'
    }

    const canSkipUpload = Boolean(person.designationDriveFileId) && !opts.force
    if (canSkipUpload) {
      await syncBrevo(person.email, person.designationPdfUrl ?? '')
      await deps.data.save({
        id: person.id,
        mir,
        number,
        issuedAt,
        pdfUrl: person.designationPdfUrl,
        driveFileId: person.designationDriveFileId,
      })
      return 'skipped'
    }

    if (!deps.drive || !deps.folderId) throw new Error('Липсва Google Drive клиент или DRIVE_FOLDER_ID.')
    const file = await deps.drive.uploadPdf({
      name: filename,
      bytes,
      folderId: deps.folderId,
      fileId: opts.force ? person.designationDriveFileId ?? undefined : undefined,
    })
    await syncBrevo(person.email, file.webViewLink)
    await deps.data.save({
      id: person.id,
      mir,
      number,
      issuedAt,
      pdfUrl: file.webViewLink,
      driveFileId: file.id,
    })
    return 'uploaded'
  }

  async function syncBrevo(email: string, url: string) {
    if (!url || !deps.brevoApiKey || !hasRealEmail(email)) return
    await updateBrevoContactAttribute(deps.brevoApiKey, email, { [deps.config.brevoAttribute]: url })
  }
}

function manifestRow(item: AssignedPerson, config: DesignationConfig): ManifestRow {
  const name = [item.person.firstName, item.person.middleName, item.person.lastName].filter(Boolean).join(' ')
  const number = formatDesignationNumber(item.number, config.numberPrefix)
  return {
    personId: item.person.id,
    email: item.person.email,
    name,
    number,
    issuedAt: item.issuedAt,
    section: item.person.sectionCode,
    fileName: bulkDesignationFilename({
      number: item.number,
      section: item.person.sectionCode,
      firstName: item.person.firstName,
      middleName: item.person.middleName,
      lastName: item.person.lastName,
    }),
    driveUrl: item.person.designationPdfUrl ?? '',
    driveFileId: item.person.designationDriveFileId ?? '',
  }
}

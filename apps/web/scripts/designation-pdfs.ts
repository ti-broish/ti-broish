import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  configFromEnv,
  grantorFromEnv,
  runDesignationJob,
  runSamplePdf,
  type DesignationDataSource,
  type DesignationPersonRow,
} from '../src/signup/designation-job'
import { createDriveClient, readDriveAuth } from '../src/signup/designation-drive'
import {
  IMPORT_LOOKUP_BATCH,
  IMPORT_SAVE_BATCH,
  formatImportSummary,
  parseImportSource,
  runDesignationImport,
  type DesignationImportDataSource,
  type DesignationImportPerson,
} from '../src/signup/designation-import'
import { parseStoredNumber } from '../src/signup/designation-number'
import {
  designationImportLookupSql,
  designationLinkUpdateBatchSql,
  sqlBatches,
  sqlLiteral,
} from '../src/signup/designation-sql'
import { todayInSofia } from '../src/signup/designation-config'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface CliArgs {
  env: 'staging' | 'production' | 'local'
  out: string
  dryRun: boolean
  localOnly: boolean
  person: string
  limit: number
  force: boolean
  sample: boolean
  concurrency: number
  importFile: string
  skipBrevo: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    env: 'local',
    out: './designation-pdfs',
    dryRun: false,
    localOnly: false,
    person: '',
    limit: 0,
    force: false,
    sample: false,
    concurrency: 3,
    importFile: '',
    skipBrevo: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] ?? ''
    const next = () => argv[++i] ?? ''
    if (flag === '--env') args.env = asEnv(next())
    else if (flag === '--out') args.out = next()
    else if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--local-only') args.localOnly = true
    else if (flag === '--person') args.person = next()
    else if (flag === '--limit') args.limit = Math.max(0, Number(next()) || 0)
    else if (flag === '--force') args.force = true
    else if (flag === '--sample') args.sample = true
    else if (flag === '--concurrency') args.concurrency = Math.max(1, Number(next()) || 3)
    else if (flag === '--import') args.importFile = next()
    else if (flag === '--skip-brevo') args.skipBrevo = true
    else if (flag === '--help' || flag === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Непознат флаг ${flag}`)
    }
  }
  if (args.importFile && args.sample) throw new Error('--import не се комбинира с --sample.')
  if (args.importFile === '' && argv.includes('--import')) throw new Error('--import иска път до CSV или JSON.')
  return args
}

function asEnv(value: string): CliArgs['env'] {
  if (value === 'staging' || value === 'production' || value === 'local') return value
  throw new Error('--env трябва да е staging, production или local.')
}

function printHelp() {
  process.stdout.write(`Пълномощни (designation PDFs)

  pnpm designation-pdfs --sample --out ./designation-sample.pdf
  pnpm designation-pdfs --env local --local-only --dry-run
  pnpm designation-pdfs --env local --local-only --out ./designation-pdfs
  pnpm designation-pdfs --import ./designation-pdfs/manifest.csv --env local
  pnpm designation-pdfs --env staging --person <id>

Drive:
  A) service account upload — generate without --local-only (DRIVE_FOLDER_ID +
     GOOGLE_SERVICE_ACCOUNT_JSON). Writes designation_pdf_url and syncs Brevo.
  B) manual upload + --import — generate with --local-only, upload the PDFs
     yourself, fill driveUrl in manifest.csv / manifest.json, then --import.

Манифест (--local-only, not --dry-run): manifest.csv and manifest.json in --out.
  Columns: personId,email,name,number,issuedAt,section,fileName,driveUrl,driveFileId
  No ЕГН. driveUrl / driveFileId are copied from D1 when already stored.

Import: --import <file.csv|file.json> --env local|staging|production
  [--dry-run] [--skip-brevo]
  personId and/or email (at least one), driveUrl required, driveFileId optional.
  Extra columns are ignored. Empty driveUrl rows count as „без линк“.

Флагове: --env staging|production|local, --out <dir|file>, --dry-run,
  --local-only, --person <id>, --limit N, --force, --sample, --concurrency N,
  --import <file>, --skip-brevo
`)
}

function logLine(line: string) {
  process.stdout.write(`${line}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = process.env
  const config = configFromEnv(env)
  const grantor = grantorFromEnv(env)
  const issuedOn = (env.DESIGNATION_ISSUED_ON ?? '').trim() || todayInSofia()

  if (args.sample) {
    const outPath = sampleOutPath(args.out)
    await mkdir(dirname(outPath), { recursive: true })
    await runSamplePdf({ outPath, config, grantor, issuedOn })
    logLine(`записан образец ${outPath}`)
    return
  }

  if (args.importFile) {
    await runImport(args, config)
    return
  }

  const data = wranglerDataSource(args.env)
  const folderId = (env.DRIVE_FOLDER_ID ?? '').trim()
  const drive =
    args.localOnly || args.dryRun
      ? null
      : createDriveClient(readDriveAuth(env))
  const summary = await runDesignationJob(
    {
      outDir: resolve(args.out),
      dryRun: args.dryRun,
      localOnly: args.localOnly,
      force: args.force,
      personId: args.person || undefined,
      limit: args.limit || undefined,
      concurrency: args.concurrency,
    },
    {
      data,
      config,
      grantor,
      issuedOn,
      drive,
      folderId,
      brevoApiKey: args.localOnly || args.dryRun ? undefined : (env.BREVO_API_KEY ?? '').trim() || undefined,
      log: logLine,
    },
  )
  logLine(
    `готово: ${summary.total} души, ${summary.generated} PDF, ${summary.uploaded} качени, ${summary.skipped} пропуснати, ${summary.failed} грешки`,
  )
  for (const error of summary.errors) logLine(error)
  if (summary.failed > 0) process.exitCode = 1
}

function sampleOutPath(out: string) {
  if (out.endsWith('.pdf')) return resolve(out)
  return resolve(out, 'designation-sample.pdf')
}

async function runImport(args: CliArgs, config: ReturnType<typeof configFromEnv>) {
  if (!args.importFile || args.importFile.startsWith('--')) {
    throw new Error('--import иска път до CSV или JSON.')
  }
  const path = resolve(args.importFile)
  const text = await readFile(path, 'utf8')
  const parsed = parseImportSource(text, path)
  const brevoApiKey = (process.env.BREVO_API_KEY ?? '').trim()
  const summary = await runDesignationImport(
    { dryRun: args.dryRun, skipBrevo: args.skipBrevo },
    {
      data: wranglerImportDataSource(args.env),
      parsed,
      config,
      brevoApiKey: args.dryRun || args.skipBrevo ? undefined : brevoApiKey || undefined,
      log: logLine,
    },
  )
  for (const line of formatImportSummary(summary)) logLine(line)
  if (summary.invalid + summary.notFound + summary.unpublished + summary.errors.length > 0) process.exitCode = 1
}

function wranglerImportDataSource(envName: CliArgs['env']): DesignationImportDataSource {
  return {
    async findPeople(keys) {
      await ensureColumns(envName)
      const ids = [...new Set(keys.ids.filter(Boolean))]
      const emails = [...new Set(keys.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
      const found = new Map<string, DesignationImportPerson>()
      for (const batch of sqlBatches(ids, IMPORT_LOOKUP_BATCH)) {
        const sql = designationImportLookupSql(batch, [])
        if (!sql) continue
        for (const row of await d1Query<ImportRawRow>(envName, sql)) found.set(row.id, fromImportRaw(row))
      }
      for (const batch of sqlBatches(emails, IMPORT_LOOKUP_BATCH)) {
        const sql = designationImportLookupSql([], batch)
        if (!sql) continue
        for (const row of await d1Query<ImportRawRow>(envName, sql)) found.set(row.id, fromImportRaw(row))
      }
      return [...found.values()]
    },
    async saveLinks(rows) {
      const updatedAt = new Date().toISOString()
      for (const batch of sqlBatches(rows, IMPORT_SAVE_BATCH)) {
        await d1Execute(envName, designationLinkUpdateBatchSql(batch, updatedAt))
      }
    },
  }
}

interface ImportRawRow {
  id: string
  email: string
  published_section: string
}

function fromImportRaw(row: ImportRawRow): DesignationImportPerson {
  return { id: row.id, email: row.email, publishedSection: row.published_section }
}

function wranglerDataSource(envName: CliArgs['env']): DesignationDataSource {
  return {
    async list(opts) {
      await ensureColumns(envName)
      const where = [
        "COALESCE(published_section, '') != ''",
        'COALESCE(withdrawn, 0) = 0',
      ]
      if (opts.personId) where.push(`id = ${sqlLiteral(opts.personId)}`)
      const limit = opts.limit && opts.limit > 0 ? ` LIMIT ${Math.floor(opts.limit)}` : ''
      const sql = `SELECT id, email,
        COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
        COALESCE(json_extract(payload, '$.middleName'), '') AS middle_name,
        COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
        COALESCE(egn, '') AS egn,
        COALESCE(published_section, '') AS section_code,
        COALESCE(NULLIF(section_place, ''), json_extract(payload, '$.place.sectionPlace'), '') AS section_place,
        designation_number, designation_issued_at, designation_pdf_url, designation_drive_file_id
        FROM signups WHERE ${where.join(' AND ')} ORDER BY designation_number IS NULL, designation_number, updated_at${limit}`
      const rows = await d1Query<RawRow>(envName, sql)
      return rows.map(fromRaw)
    },
    async maxNumber() {
      const rows = await d1Query<{ n: number | null }>(envName, 'SELECT MAX(designation_number) AS n FROM signups')
      return Number(rows[0]?.n ?? 0) || 0
    },
    async save(row) {
      const sql = `UPDATE signups SET
        designation_number = ${sqlLiteral(row.number)},
        designation_issued_at = ${sqlLiteral(row.issuedAt)},
        designation_pdf_url = ${sqlLiteral(row.pdfUrl)},
        designation_drive_file_id = ${sqlLiteral(row.driveFileId)},
        updated_at = ${sqlLiteral(new Date().toISOString())}
        WHERE id = ${sqlLiteral(row.id)};`
      await d1Execute(envName, sql)
    },
  }
}

interface RawRow {
  id: string
  email: string
  first_name: string
  middle_name: string
  last_name: string
  egn: string
  section_code: string
  section_place: string
  designation_number: number | string | null
  designation_issued_at: string | null
  designation_pdf_url: string | null
  designation_drive_file_id: string | null
}

function fromRaw(row: RawRow): DesignationPersonRow {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    egn: row.egn,
    sectionCode: row.section_code,
    sectionPlace: row.section_place,
    designationNumber: parseStoredNumber(row.designation_number),
    designationIssuedAt: row.designation_issued_at,
    designationPdfUrl: row.designation_pdf_url,
    designationDriveFileId: row.designation_drive_file_id,
  }
}

const ADD_COLUMNS = [
  'ALTER TABLE signups ADD COLUMN designation_number INTEGER',
  'ALTER TABLE signups ADD COLUMN designation_issued_at TEXT',
  'ALTER TABLE signups ADD COLUMN designation_pdf_url TEXT',
  'ALTER TABLE signups ADD COLUMN designation_drive_file_id TEXT',
  'ALTER TABLE signups ADD COLUMN designation_generated_at TEXT',
  'ALTER TABLE signups ADD COLUMN designation_signed_at TEXT',
]

async function ensureColumns(envName: CliArgs['env']) {
  for (const sql of ADD_COLUMNS) {
    try {
      await d1Execute(envName, sql)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/duplicate column/i.test(message)) throw error
    }
  }
}

async function d1Query<T>(envName: CliArgs['env'], sql: string): Promise<T[]> {
  const raw = await wrangler(['d1', 'execute', dbName(envName), ...envFlags(envName), '--json', '--command', sql])
  return parseResults<T>(raw)
}

async function d1Execute(envName: CliArgs['env'], sql: string) {
  await wrangler(['d1', 'execute', dbName(envName), ...envFlags(envName), '--command', sql])
}

function dbName(envName: CliArgs['env']) {
  return envName === 'production' ? 'ti-broish-signup' : 'ti-broish-signup-staging'
}

function envFlags(envName: CliArgs['env']) {
  if (envName === 'production') return ['--env', 'production', '--remote']
  if (envName === 'staging') return ['--remote']
  return ['--local']
}

function parseResults<T>(raw: string): T[] {
  const start = raw.indexOf('[')
  const objectStart = raw.indexOf('{')
  const jsonText = start >= 0 && (objectStart < 0 || start < objectStart) ? raw.slice(start) : raw.slice(Math.max(0, objectStart))
  const parsed = JSON.parse(jsonText) as unknown
  const blocks = Array.isArray(parsed) ? parsed : [parsed]
  const rows: T[] = []
  for (const block of blocks) {
    if (block && typeof block === 'object' && 'results' in block && Array.isArray((block as { results: T[] }).results)) {
      rows.push(...(block as { results: T[] }).results)
    }
  }
  return rows
}

function wrangler(args: string[]) {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn('pnpm', ['exec', 'wrangler', ...args], {
      cwd: WEB_ROOT,
      env: process.env,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise(out)
        return
      }
      reject(new Error(err.trim() || out.trim() || `wrangler излезе с код ${code}`))
    })
  })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
})

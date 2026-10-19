import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGNATION_CONFIG } from './designation-config'
import {
  MANIFEST_COLUMNS,
  deriveDriveFileId,
  formatImportSummary,
  parseImportSource,
  runDesignationImport,
  serializeManifestCsv,
  serializeManifestJson,
  sortManifest,
  validateDriveUrl,
  type DesignationImportDataSource,
  type DesignationImportPerson,
  type ManifestRow,
  type ParsedImport,
} from './designation-import'
import { designationImportLookupSql, designationLinkUpdateBatchSql, sqlLiteral } from './designation-sql'

const FILE = 'https://drive.google.com/file/d/abc123xyz/view?usp=sharing'
const DOC = 'https://docs.google.com/document/d/doc456/edit'
const OPEN = 'https://drive.google.com/open?id=open789'

function manifest(overrides: Partial<ManifestRow> = {}): ManifestRow {
  return {
    personId: 'p1',
    email: 'ivan@example.com',
    name: 'Иван Петров Иванов',
    number: '1',
    issuedAt: '18.10.2026',
    section: '234600001',
    fileName: 'Пълномощно 1 – Иван Петров Иванов.pdf',
    driveUrl: '',
    driveFileId: '',
    ...overrides,
  }
}

function memoryImport(people: DesignationImportPerson[]) {
  const saved: Array<{ id: string; pdfUrl: string; driveFileId: string | null }> = []
  const data: DesignationImportDataSource = {
    async findPeople(keys) {
      const ids = new Set(keys.ids)
      const emails = new Set(keys.emails.map((email) => email.toLowerCase()))
      return people.filter((person) => ids.has(person.id) || emails.has(person.email.toLowerCase()))
    },
    async saveLinks(rows) {
      saved.push(...rows)
    },
  }
  return { data, saved }
}

describe('manifest serialize', () => {
  it('writes CSV with BOM, header order, quoting, and no ЕГН', () => {
    const rows = sortManifest([
      manifest({ personId: 'p2', number: '10', name: 'Мария, Георгиева', email: 'maria@example.com' }),
      manifest({
        personId: 'p1',
        number: '2',
        driveUrl: FILE,
        driveFileId: 'abc123xyz',
      }),
    ])
    expect(rows.map((row) => row.personId)).toEqual(['p1', 'p2'])
    const csv = serializeManifestCsv(rows)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const body = csv.replace(/^\uFEFF/, '')
    expect(body.startsWith(`${MANIFEST_COLUMNS.join(',')}\n`)).toBe(true)
    expect(MANIFEST_COLUMNS.join(',')).toBe('personId,email,name,number,issuedAt,section,fileName,driveUrl,driveFileId')
    expect(csv).toContain('"Мария, Георгиева"')
    expect(csv).toContain(FILE)
    expect(csv).not.toMatch(/\bегн\b/i)
    expect(csv).not.toContain('8001010000')
    const json = serializeManifestJson(rows)
    const parsed = JSON.parse(json) as ManifestRow[]
    expect(parsed[0]?.driveFileId).toBe('abc123xyz')
    expect(json).not.toContain('8001010000')
  })
})

describe('parse import source', () => {
  it('parses a filled manifest CSV, aliases, extra columns, and empty driveUrl as без линк', () => {
    const csv = `\uFEFFpersonId,email,name,number,driveUrl,driveFileId,egn
p1,ivan@example.com,Иван,1,${FILE},abc123xyz,8001010000
p2,maria@example.com,Мария,2,,,
`
    const parsed = parseImportSource(csv, 'manifest.csv')
    expect(parsed.total).toBe(2)
    expect(parsed.rows).toEqual([
      { rowNumber: 2, personId: 'p1', email: 'ivan@example.com', driveUrl: FILE, driveFileId: 'abc123xyz' },
    ])
    expect(parsed.issues).toEqual([{ rowNumber: 3, kind: 'no-link', reason: 'без линк' }])
    expect(JSON.stringify(parsed)).not.toContain('8001010000')
  })

  it('accepts JSON array and {rows}, case-insensitive aliases, and derives file id', () => {
    const parsed = parseImportSource(
      JSON.stringify({
        rows: [
          { Person_ID: 'p1', Drive_URL: FILE },
          { email: 'maria@example.com', url: DOC },
          { id: 'p3', driveUrl: OPEN },
        ],
      }),
      'links.json',
    )
    expect(parsed.rows.map((row) => row.driveFileId)).toEqual(['abc123xyz', 'doc456', 'open789'])
    expect(parsed.rows[1]?.personId).toBe('')
    expect(parsed.rows[1]?.email).toBe('maria@example.com')
  })

  it('marks invalid URLs and missing identity', () => {
    const parsed = parseImportSource(
      JSON.stringify([
        { personId: 'p1', driveUrl: 'http://drive.google.com/file/d/x/view' },
        { personId: 'p2', driveUrl: 'https://example.com/file' },
        { driveUrl: FILE },
        { personId: 'p4', driveUrl: 'not a url' },
      ]),
    )
    expect(parsed.rows).toEqual([])
    expect(parsed.issues.map((issue) => issue.reason)).toEqual([
      'driveUrl трябва да е https на drive.google.com или docs.google.com',
      'driveUrl трябва да е https на drive.google.com или docs.google.com',
      'липсва personId или email',
      'невалиден URL',
    ])
  })
})

describe('drive url helpers', () => {
  it('accepts https Drive/Docs hosts and derives ids', () => {
    expect(validateDriveUrl(FILE).ok).toBe(true)
    expect(validateDriveUrl(DOC).ok).toBe(true)
    expect(deriveDriveFileId(FILE)).toBe('abc123xyz')
    expect(deriveDriveFileId(DOC)).toBe('doc456')
    expect(deriveDriveFileId(OPEN)).toBe('open789')
    expect(deriveDriveFileId('https://drive.google.com/uc?id=ucId1&export=download')).toBe('ucId1')
    expect(validateDriveUrl('https://other.google.com/file/d/x/view').ok).toBe(false)
  })
})

describe('import SQL', () => {
  it('looks up by id/email without ЕГН and updates links without designation_number', () => {
    const lookup = designationImportLookupSql(['p1'], ['Ivan@Example.com'])
    expect(lookup).toContain("id IN ('p1')")
    expect(lookup).toContain("lower(email) IN ('ivan@example.com')")
    expect(lookup).toContain('published_section')
    expect(lookup).not.toMatch(/egn/i)
    const sql = designationLinkUpdateBatchSql(
      [
        { id: "O'Brien", pdfUrl: FILE, driveFileId: 'abc' },
        { id: 'p2', pdfUrl: DOC, driveFileId: null },
      ],
      '2026-10-18T10:00:00.000Z',
    )
    expect(sql).toContain(`designation_pdf_url = ${sqlLiteral(FILE)}`)
    expect(sql).toContain("id = 'O''Brien'")
    expect(sql).toContain('designation_drive_file_id = NULL')
    expect(sql).not.toContain('designation_number')
    expect(sql).not.toMatch(/egn/i)
  })
})

describe('runDesignationImport', () => {
  const people: DesignationImportPerson[] = [
    { id: 'p1', email: 'ivan@example.com', publishedSection: '234600001' },
    { id: 'p2', email: 'maria@example.com', publishedSection: '234600002' },
    { id: 'p3', email: 'draft@example.com', publishedSection: '' },
  ]

  it('updates D1 and Brevo, skips без линк, and reports not found / unpublished / disagree', async () => {
    const { data, saved } = memoryImport(people)
    const logs: string[] = []
    const brevo: Array<{ url: string; body: string }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      brevo.push({ url: String(input), body: String(init?.body ?? '') })
      return new Response(null, { status: 204 })
    }
    const parsed: ParsedImport = parseImportSource(
      JSON.stringify([
        { personId: 'p1', email: 'ivan@example.com', driveUrl: FILE },
        { email: 'maria@example.com', driveUrl: DOC },
        { personId: 'missing', driveUrl: FILE },
        { personId: 'p3', driveUrl: FILE },
        { personId: 'p1', email: 'maria@example.com', driveUrl: FILE },
        { personId: 'p2', driveUrl: '' },
      ]),
    )
    const summary = await runDesignationImport(
      { dryRun: false, skipBrevo: false },
      {
        data,
        parsed,
        config: DEFAULT_DESIGNATION_CONFIG,
        brevoApiKey: 'secret-key',
        fetchImpl,
        log: (line) => logs.push(line),
      },
    )
    expect(summary.rows).toBe(6)
    expect(summary.updated).toBe(2)
    expect(summary.brevoSynced).toBe(2)
    expect(summary.noLink).toBe(1)
    expect(summary.notFound).toBe(1)
    expect(summary.unpublished).toBe(1)
    expect(summary.invalid).toBe(1)
    expect(saved).toEqual([
      { id: 'p1', pdfUrl: FILE, driveFileId: 'abc123xyz' },
      { id: 'p2', pdfUrl: DOC, driveFileId: 'doc456' },
    ])
    expect(brevo).toHaveLength(2)
    expect(brevo[0]?.body).toContain('DOCUMENT_URL')
    expect(brevo[0]?.body).toContain(FILE)
    const printed = formatImportSummary(summary).join('\n')
    expect(printed).toContain('без линк')
    expect(printed).toContain('няма signup за missing')
    expect(printed).toContain('няма публикувана секция')
    expect(printed).toContain('различни хора')
    expect(printed).not.toContain('8001010000')
    expect(logs.join('\n')).not.toContain('secret-key')
  })

  it('dry-run and --skip-brevo write nothing to D1/Brevo; missing key warns', async () => {
    const { data, saved } = memoryImport(people)
    const parsed = parseImportSource(JSON.stringify([{ personId: 'p1', driveUrl: FILE }]))
    const fetchImpl: typeof fetch = async () => {
      throw new Error('fetch must not run')
    }
    const dry = await runDesignationImport(
      { dryRun: true, skipBrevo: false },
      { data, parsed, config: DEFAULT_DESIGNATION_CONFIG, brevoApiKey: 'secret-key', fetchImpl },
    )
    expect(dry.updated).toBe(1)
    expect(dry.brevoSynced).toBe(0)
    expect(saved).toEqual([])

    const skipLogs: string[] = []
    const skipped = await runDesignationImport(
      { dryRun: false, skipBrevo: true },
      {
        data,
        parsed,
        config: DEFAULT_DESIGNATION_CONFIG,
        brevoApiKey: 'secret-key',
        fetchImpl,
        log: (line) => skipLogs.push(line),
      },
    )
    expect(skipped.updated).toBe(1)
    expect(skipped.brevoSynced).toBe(0)
    expect(saved).toHaveLength(1)

    const warnLogs: string[] = []
    await runDesignationImport(
      { dryRun: false, skipBrevo: false },
      {
        data,
        parsed,
        config: DEFAULT_DESIGNATION_CONFIG,
        fetchImpl,
        log: (line) => warnLogs.push(line),
      },
    )
    expect(warnLogs.some((line) => line.includes('BREVO_API_KEY'))).toBe(true)
  })
})

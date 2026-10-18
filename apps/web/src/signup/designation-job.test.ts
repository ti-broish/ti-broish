import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGNATION_CONFIG } from './designation-config'
import { MANIFEST_COLUMNS } from './designation-import'
import { sqlLiteral } from './designation-sql'
import {
  runDesignationJob,
  samplePerson,
  type DesignationDataSource,
  type DesignationPersonRow,
  type DesignationSave,
} from './designation-job'

const grantor = { name: '', egn: '', capacity: 'пълномощник' as const, authorisation: '' }

function person(overrides: Partial<DesignationPersonRow> = {}): DesignationPersonRow {
  return { ...samplePerson(), id: 'p1', email: 'ivan@example.com', ...overrides }
}

function memoryData(rows: DesignationPersonRow[], max = 0) {
  const saved: DesignationSave[] = []
  const data: DesignationDataSource = {
    async list() {
      return rows
    },
    async maxNumber() {
      return max
    },
    async save(row) {
      saved.push(row)
    },
  }
  return { data, saved }
}

describe('designation job', () => {
  it('dry-run prints a plan, keeps existing numbers, and writes nothing', async () => {
    const logs: string[] = []
    const existing = person({ designationNumber: 7, egn: '8001010000' })
    const fresh = person({ id: 'p2', designationNumber: null, firstName: 'Мария', lastName: 'Георгиева', egn: '8002020000' })
    const { data, saved } = memoryData([existing, fresh], 7)
    const render = async () => {
      throw new Error('dry-run must not render')
    }
    const summary = await runDesignationJob(
      { outDir: '/tmp/unused', dryRun: true, localOnly: false, force: false, concurrency: 2 },
      {
        data,
        config: DEFAULT_DESIGNATION_CONFIG,
        grantor,
        issuedOn: '18.10.2026',
        log: (line) => logs.push(line),
        render,
      },
    )
    expect(summary.total).toBe(2)
    expect(summary.generated).toBe(2)
    expect(summary.uploaded).toBe(0)
    expect(saved).toEqual([])
    expect(logs.some((line) => line.includes('№ 7') && line.includes('p1'))).toBe(true)
    expect(logs.some((line) => line.includes('№ 8') && line.includes('p2'))).toBe(true)
    expect(logs.join('\n')).not.toContain('8001010000')
    expect(logs.join('\n')).not.toContain('8002020000')
  })

  it('skips Drive upload when a file id exists unless force is set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'designation-'))
    try {
      const { data, saved } = memoryData([
        person({ designationNumber: 3, designationDriveFileId: 'file-3', designationPdfUrl: 'https://drive.example/file-3', designationIssuedAt: '01.10.2026' }),
      ])
      const render = async () => new Uint8Array([1])
      const uploads: Array<{ fileId?: string }> = []
      const summary = await runDesignationJob(
        { outDir: dir, dryRun: false, localOnly: false, force: false, concurrency: 1 },
        {
          data,
          config: DEFAULT_DESIGNATION_CONFIG,
          grantor,
          issuedOn: '18.10.2026',
          render,
          drive: {
            async uploadPdf(input) {
              uploads.push({ fileId: input.fileId })
              return { id: 'new', webViewLink: 'https://drive.example/new' }
            },
          },
          folderId: 'folder',
        },
      )
      expect(summary.skipped).toBe(1)
      expect(uploads).toEqual([])
      expect(saved[0]?.number).toBe(3)
      expect(saved[0]?.issuedAt).toBe('01.10.2026')
      expect(saved[0]?.driveFileId).toBe('file-3')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('escapes SQL literals', () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'")
    expect(sqlLiteral(12)).toBe('12')
    expect(sqlLiteral(null)).toBe('NULL')
  })

  it('local-only writes PDFs and a sorted manifest without ЕГН, pre-filling Drive links', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'designation-manifest-'))
    try {
      const existing = person({
        id: 'p-high',
        designationNumber: 9,
        firstName: 'Мария',
        lastName: 'Георгиева',
        egn: '8002020000',
        email: 'maria@example.com',
        sectionCode: '234600002',
      })
      const withLink = person({
        id: 'p-low',
        designationNumber: 3,
        designationDriveFileId: 'file-3',
        designationPdfUrl: 'https://drive.google.com/file/d/file-3/view',
        designationIssuedAt: '01.10.2026',
        egn: '8001010000',
      })
      const { data, saved } = memoryData([existing, withLink], 9)
      const summary = await runDesignationJob(
        { outDir: dir, dryRun: false, localOnly: true, force: false, concurrency: 2 },
        {
          data,
          config: DEFAULT_DESIGNATION_CONFIG,
          grantor,
          issuedOn: '18.10.2026',
          render: async () => new Uint8Array([1, 2, 3]),
        },
      )
      expect(summary.generated).toBe(2)
      expect(summary.uploaded).toBe(0)
      expect(saved.map((row) => row.number).sort((a, b) => a - b)).toEqual([3, 9])
      expect(saved.every((row) => row.number !== null)).toBe(true)
      const names = await readdir(dir)
      expect(names).toContain('manifest.csv')
      expect(names).toContain('manifest.json')
      const csv = await readFile(join(dir, 'manifest.csv'), 'utf8')
      expect(csv.startsWith('\uFEFF')).toBe(true)
      const lines = csv.replace(/^\uFEFF/, '').trimEnd().split('\n')
      expect(lines[0]).toBe(MANIFEST_COLUMNS.join(','))
      expect(lines[1]).toContain('p-low')
      expect(lines[1]).toContain('https://drive.google.com/file/d/file-3/view')
      expect(lines[1]).toContain('file-3')
      expect(lines[2]).toContain('p-high')
      expect(lines[2]).toMatch(/,,$/)
      expect(csv).not.toContain('8001010000')
      expect(csv).not.toContain('8002020000')
      expect(csv).not.toMatch(/\bегн\b/i)
      const json = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Array<{ personId: string; driveUrl: string }>
      expect(json.map((row) => row.personId)).toEqual(['p-low', 'p-high'])
      expect(json[0]?.driveUrl).toBe('https://drive.google.com/file/d/file-3/view')
      expect(JSON.stringify(json)).not.toContain('8001010000')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('dry-run does not write a manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'designation-dry-'))
    try {
      const { data } = memoryData([person({ designationNumber: 1 })], 1)
      await runDesignationJob(
        { outDir: dir, dryRun: true, localOnly: true, force: false, concurrency: 1 },
        {
          data,
          config: DEFAULT_DESIGNATION_CONFIG,
          grantor,
          issuedOn: '18.10.2026',
          render: async () => {
            throw new Error('dry-run must not render')
          },
        },
      )
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

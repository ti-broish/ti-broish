import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGNATION_CONFIG } from './designation-config'
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
})

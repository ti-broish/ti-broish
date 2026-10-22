import { describe, expect, it } from 'vitest'
import { SIGNED_PDF_FETCH_WINDOW, orderedPrefetch, writeSignedWaveZip, type SignedPerson } from './signed-waves'

const person = (id: string, mir: string, number: number): SignedPerson => ({
  id,
  firstName: 'Тодор',
  middleName: 'Иванов',
  lastName: `Пробов${number}`,
  egn: '',
  mir,
  number,
  issuedAt: '19.10.2026',
  firstSignedAt: '2026-10-19T17:58:04.778Z',
  driveFileId: `drive-${id}`,
  partner: false,
})

describe('signed ZIP Drive downloads', () => {
  it('orderedPrefetch keeps at most `window` jobs ahead of the reader and returns them in order', async () => {
    const started: number[] = []
    const take = orderedPrefetch([0, 1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      started.push(n)
      return n * 10
    })
    expect(await take(0)).toBe(0)
    expect(started).toEqual([0, 1, 2])
    expect(await take(1)).toBe(10)
    expect(started).toEqual([0, 1, 2, 3])
    expect(await take(7)).toBe(70)
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('a failed download rejects only its own slot', async () => {
    const take = orderedPrefetch(['a', 'bad', 'c'], 2, async (id) => {
      if (id === 'bad') throw new Error('Drive HTTP 404')
      return id
    })
    await expect(take(0)).resolves.toBe('a')
    await expect(take(1)).rejects.toThrow('404')
    await expect(take(2)).resolves.toBe('c')
  })

  it('downloads in parallel (bounded) and still writes the PDFs in РИК and number order', async () => {
    const people = [person('a', '23', 3), person('b', '02', 9), person('c', '02', 1), ...Array.from({ length: 12 }, (_, i) => person(`x${i}`, '17', 100 + i))]
    let inFlight = 0
    let peak = 0
    const names: string[] = []
    await writeSignedWaveZip(
      async (name) => {
        names.push(name)
      },
      {
        people,
        committeeFullName: 'Комитет',
        numberPrefix: '',
        tablesOnly: false,
        fetchPdf: async (fileId) => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 5))
          inFlight -= 1
          return new TextEncoder().encode(`%PDF-${fileId}`)
        },
      },
    )
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(SIGNED_PDF_FETCH_WINDOW)
    const pdfs = names.filter((name) => name.endsWith('.pdf'))
    expect(pdfs).toHaveLength(15)
    expect(pdfs[0]).toMatch(/^РИК 02\/02_1_/)
    expect(pdfs[1]).toMatch(/^РИК 02\/02_9_/)
    expect(pdfs[2]).toMatch(/^РИК 17\/17_100_/)
    expect(pdfs.at(-1)).toMatch(/^РИК 23\/23_3_/)
  })
})

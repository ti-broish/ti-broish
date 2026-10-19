import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { collectStream, streamStoredZip } from './designation-zip-stream'

describe('streaming ZIP', () => {
  it('stores files without compressing them and includes the given names', async () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new TextEncoder().encode('hello')
    const bytes = await collectStream(
      streamStoredZip([
        { name: '0001_234600101_Petrova.pdf', bytes: a },
        { name: 'manifest.csv', bytes: b },
      ]),
    )
    const files = unzipSync(bytes)
    expect([...files['0001_234600101_Petrova.pdf']!]).toEqual([1, 2, 3, 4])
    expect(new TextDecoder().decode(files['manifest.csv'])).toBe('hello')
  })
})

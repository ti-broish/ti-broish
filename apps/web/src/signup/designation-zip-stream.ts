import { Zip, ZipPassThrough } from 'fflate'

export function streamStoredZip(files: Array<{ name: string; bytes: Uint8Array }>): ReadableStream<Uint8Array> {
  return streamZipWriter(async (add) => {
    for (const file of files) await add(file.name, file.bytes)
  })
}

export function streamZipWriter(
  write: (add: (name: string, bytes: Uint8Array) => Promise<void>) => Promise<void>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, data, final) => {
        if (err) {
          controller.error(err)
          return
        }
        if (data) controller.enqueue(data)
        if (final) controller.close()
      })
      try {
        await write(async (name, bytes) => {
          const entry = new ZipPassThrough(name)
          zip.add(entry)
          entry.push(bytes, true)
        })
        zip.end()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

export async function collectStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

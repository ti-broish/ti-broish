/**
 * Local ZIP/PDF throughput bench. Not run in CI.
 *
 *   pnpm exec tsx scripts/designation-zip-bench.ts
 */
import { DEFAULT_DESIGNATION_CONFIG } from '../src/signup/designation-config'
import { bulkDesignationFilename } from '../src/signup/designation-files'
import { renderDesignationPdf } from '../src/signup/designation-pdf'
import { collectStream, streamZipWriter } from '../src/signup/designation-zip-stream'

const COUNT = Number(process.argv[2] ?? 300)

const grantor = { name: '', egn: '', capacity: 'пълномощник' as const, authorisation: '', principalName: '', principalEgn: '' }

async function main() {
  const started = performance.now()
  let pdfBytes = 0
  let files = 0
  const zipBytes = await collectStream(
    streamZipWriter(async (add) => {
      for (let i = 1; i <= COUNT; i++) {
        const bytes = await renderDesignationPdf(
          {
            number: i,
            issuedOn: '19.10.2026',
            grantor,
            person: {
              firstName: 'Иван',
              middleName: 'Петров',
              lastName: 'Иванов',
              egn: '0000000000',
              sectionCode: '234600001',
              sectionPlace: 'гр. София',
            },
          },
          DEFAULT_DESIGNATION_CONFIG,
        )
        pdfBytes += bytes.byteLength
        files += 1
        await add(bulkDesignationFilename({ number: i, section: '234600001', lastName: 'Иванов' }), bytes)
      }
    }),
  )
  const ms = performance.now() - started
  const perPdf = ms / files
  const bytesPerPdf = pdfBytes / files
  process.stdout.write(
    [
      `pdfs=${files}`,
      `totalMs=${ms.toFixed(0)}`,
      `msPerPdf=${perPdf.toFixed(1)}`,
      `pdfBytes=${pdfBytes}`,
      `bytesPerPdf=${bytesPerPdf.toFixed(0)}`,
      `zipBytes=${zipBytes.byteLength}`,
    ].join(' ') + '\n',
  )
}

void main()

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { AdminHeading, adminGhost, adminInput } from '../../components/admin-ui'
import {
  adminDesignationHealth,
  adminDesignationNumber,
  adminDesignationStatus,
  adminDesignationSyncBrevo,
} from '../../signup/designation-bulk'
import {
  DESIGNATION_ZIP_BATCH_LIMIT,
  expandUploadFiles,
  matchSignedFiles,
  toFilePerson,
  zipBatchPlan,
  type DesignationCounts,
  type DesignationMirOption,
  type DesignationPersonView,
  type MatchedUpload,
  type SignedUploadMatch,
} from '../../signup/designation-files'

export const Route = createFileRoute('/admin/palnomoshtni')({
  component: PalnomoshtniPage,
})

const EXPORT_REASON = 'Нужно е право за експорт (редактор или админ).'

function PalnomoshtniPage() {
  const access = useAdminAccess()
  const canExport = access.permissions.exportCampaign
  const [mir, setMir] = useState('')
  const [q, setQ] = useState('')
  const [counts, setCounts] = useState<DesignationCounts | null>(null)
  const [people, setPeople] = useState<DesignationPersonView[]>([])
  const [mirs, setMirs] = useState<DesignationMirOption[]>([])
  const [zipEligible, setZipEligible] = useState(0)
  const [healthLine, setHealthLine] = useState('Проверяваме Drive и Brevo…')
  const [canUploadDrive, setCanUploadDrive] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<SignedUploadMatch | null>(null)
  const [uploadProgress, setUploadProgress] = useState('')
  const [brevoSummary, setBrevoSummary] = useState('')
  const [uploadRows, setUploadRows] = useState<UploadResultRow[]>([])
  const [resyncFailures, setResyncFailures] = useState<string[]>([])

  const reload = useCallback(() => {
    void adminDesignationStatus({ data: { mir, q } }).then((result) => {
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setCounts(result.counts)
      setPeople(result.people)
      setMirs(result.mirs)
      setZipEligible(result.zipEligible)
    })
  }, [mir, q])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    void adminDesignationHealth().then((result) => {
      if (!result.ok) {
        setHealthLine(result.message)
        setCanUploadDrive(false)
        return
      }
      setHealthLine(result.message)
      setCanUploadDrive(result.canUpload)
    })
  }, [])

  const numberedPeople = useMemo(
    () => people.filter((row) => row.number != null).map(toFilePerson).filter((row) => row.number > 0),
    [people],
  )
  const signedCount = counts?.signed ?? 0
  const batches = zipBatchPlan(zipEligible, DESIGNATION_ZIP_BATCH_LIMIT)
  const uploadDisabledReason = !canExport ? EXPORT_REASON : !canUploadDrive ? 'Drive не е настроен. Виж реда за здраве по-горе.' : ''

  return (
    <div className="grid gap-6">
      <AdminHeading
        title="Пълномощни"
        lede="Номерирай, свали ZIP за подпис, качи подписаните PDF-и и синхронизирай линка към Brevo. ЕГН не се показва."
      />

      <section aria-labelledby="palnomoshtni-health" className="grid gap-2 rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] p-4">
        <h2 id="palnomoshtni-health" className="text-lg font-black text-[#1a1020]">
          Drive и Brevo
        </h2>
        <p className="text-sm text-[#333]">{healthLine}</p>
      </section>

      {counts ? (
        <section aria-labelledby="palnomoshtni-status" className="grid gap-3">
          <h2 id="palnomoshtni-status" className="text-lg font-black text-[#1a1020]">
            Състояние
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Публикувани секции" value={counts.published} />
            <Stat label="Номерирани" value={counts.numbered} />
            <Stat label="Генерирани" value={counts.generated} />
            <Stat label="Подписани" value={counts.signed} />
            <Stat label="Липсващи" value={counts.missing} />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="palnomoshtni-actions" className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-white p-4">
        <h2 id="palnomoshtni-actions" className="text-lg font-black text-[#1a1020]">
          Действия
        </h2>
        {!canExport ? <p className="text-sm font-bold text-[#8f1d1d]">{EXPORT_REASON}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={adminGhost}
            disabled={!canExport || busy}
            title={!canExport ? EXPORT_REASON : undefined}
            onClick={() => {
              setBusy(true)
              setMessage('')
              void adminDesignationNumber()
                .then((result) => {
                  setMessage(result.ok ? result.message : result.message)
                  if (result.ok) reload()
                })
                .finally(() => setBusy(false))
            }}
          >
            Номерирай
          </button>
          <button
            type="button"
            className={adminGhost}
            disabled={!canExport || busy || signedCount === 0}
            title={!canExport ? EXPORT_REASON : 'Праща вече качените линкове към Brevo наново, без да качваш файловете.'}
            onClick={() => {
              setBusy(true)
              setMessage('')
              setBrevoSummary('Синхронизираме с Brevo…')
              setResyncFailures([])
              const names = new Map(people.map((row) => [row.id, `${row.number ?? '—'} · ${row.name}`]))
              void resyncAllSigned((line) => setBrevoSummary(line))
                .then(({ summary, failures }) => {
                  setBrevoSummary(summary)
                  setResyncFailures(failures.map((row) => `${names.get(row.personId) ?? row.personId}: ${row.error ?? 'грешка'}`))
                })
                .catch((error) => setBrevoSummary(error instanceof Error ? `Brevo: ${error.message}` : 'Brevo синхронът се провали.'))
                .finally(() => setBusy(false))
            }}
          >
            Синхронизирай с Brevo
          </button>
        </div>
        {brevoSummary && uploadRows.length === 0 ? <p className="text-sm font-bold text-[#1a1020]">{brevoSummary}</p> : null}
        {resyncFailures.length > 0 ? (
          <ul aria-label="Грешки при синхрон с Brevo" className="list-disc pl-5 text-sm text-[#8f1d1d]">
            {resyncFailures.slice(0, 50).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-2">
          <p className="text-sm font-bold text-[#1a1020]">
            ZIP партиди: {batches.length || 0}
            {zipEligible ? ` · ${zipEligible} номерирани в този филтър, по ${DESIGNATION_ZIP_BATCH_LIMIT}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {batches.length === 0 ? (
              <p className="text-sm text-[#333]">Няма номерирани хора за ZIP в този филтър.</p>
            ) : (
              batches.map((batch) => {
                const href = `/admin/palnomoshtni/zip?mir=${encodeURIComponent(mir)}&offset=${batch.offset}&limit=${batch.limit}`
                if (!canExport) {
                  return (
                    <button key={href} type="button" className={adminGhost} disabled title={EXPORT_REASON}>
                      Изтегли ZIP {batch.from}–{batch.to}
                    </button>
                  )
                }
                return (
                  <a key={href} className={adminGhost} href={href}>
                    Изтегли ZIP {batch.from}–{batch.to}
                  </a>
                )
              })
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="palnomoshtni-upload" className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] p-4">
        <h2 id="palnomoshtni-upload" className="text-lg font-black text-[#1a1020]">
          Качване на подписани
        </h2>
        <p className="text-sm text-[#333]">
          Избери PDF-и или ZIP. Имената се съпоставят по файла ({'номер_секция_фамилия_signed.pdf'}) без ЕГН. Дубликатите не се качват, докато не махнеш излишните.
        </p>
        <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="palnomoshtni-files">
          Подписани PDF или ZIP
          <input
            id="palnomoshtni-files"
            className={adminInput}
            type="file"
            accept=".pdf,.zip,application/pdf,application/zip"
            multiple
            disabled={!canExport || busy}
            onChange={(event) => {
              const list = event.target.files
              if (!list || list.length === 0) {
                setPreview(null)
                return
              }
              void readIncoming(list).then((files) => {
                setPreview(matchSignedFiles(expandUploadFiles(files), numberedPeople))
                setBrevoSummary('')
                setUploadProgress('')
                setUploadRows([])
              })
            }}
          />
        </label>
        {preview ? <UploadPreview preview={preview} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={adminGhost}
            disabled={!canExport || !canUploadDrive || busy || !preview || preview.matched.length === 0}
            title={uploadDisabledReason || undefined}
            onClick={() => {
              if (!preview) return
              setBusy(true)
              setMessage('')
              setBrevoSummary('')
              setResyncFailures([])
              setUploadRows([])
              const matched = preview.matched
              void uploadMatched(matched, (line) => setUploadProgress(line))
                .then(async ({ uploaded, failed }) => {
                  const rows: UploadResultRow[] = matched.map((row) => {
                    const failure = failed.find((item) => item.row.personId === row.personId)
                    return {
                      personId: row.personId,
                      fileName: row.fileName,
                      person: `${row.number} · ${row.name}`,
                      drive: failure ? `грешка: ${failure.error}` : 'качен',
                      brevo: failure ? '—' : 'чака',
                      ok: !failure,
                    }
                  })
                  setUploadRows(rows)
                  const head = `Качени ${uploaded.length} от ${matched.length}`
                  if (uploaded.length === 0) {
                    setUploadProgress(`${head}.`)
                    return
                  }
                  const sync = await adminDesignationSyncBrevo({ data: { personIds: uploaded.map((row) => row.personId) } })
                  const byPerson = new Map(('results' in sync && Array.isArray(sync.results) ? sync.results : []).map((item) => [item.personId, item]))
                  setUploadRows(
                    rows.map((row) => {
                      if (row.brevo !== 'чака') return row
                      const item = byPerson.get(row.personId)
                      if (!item) return { ...row, brevo: `грешка: ${sync.message}`, ok: false }
                      return item.ok
                        ? { ...row, brevo: item.created ? 'създаден контакт' : 'обновен' }
                        : { ...row, brevo: `грешка: ${item.error ?? 'неизвестна'}`, ok: false }
                    }),
                  )
                  setUploadProgress(`${head}; ${sync.message}`)
                  reload()
                })
                .catch((error) => {
                  setMessage(error instanceof Error ? error.message : 'Качването се провали.')
                })
                .finally(() => setBusy(false))
            }}
          >
            {preview ? `Качи ${preview.matched.length} подписани` : 'Качи подписани'}
          </button>
          {uploadDisabledReason ? <p className="text-sm text-[#8f1d1d]">{uploadDisabledReason}</p> : null}
        </div>
        {uploadProgress ? (
          <p role="status" className="text-sm font-bold text-[#1a1020]">
            {uploadProgress}
          </p>
        ) : null}
        {uploadRows.length > 0 ? <UploadResults rows={uploadRows} /> : null}
      </section>

      <section aria-labelledby="palnomoshtni-table" className="grid gap-3">
        <h2 id="palnomoshtni-table" className="text-lg font-black text-[#1a1020]">
          Хора
        </h2>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="grid min-w-0 flex-1 gap-1 text-sm font-bold text-[#1a1020]" htmlFor="palnomoshtni-search">
            Търсене
            <input
              id="palnomoshtni-search"
              className={`${adminInput} w-full`}
              type="search"
              value={q}
              placeholder="Име, секция или номер"
              onChange={(event) => setQ(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="palnomoshtni-mir">
            МИР
            <select id="palnomoshtni-mir" className={adminInput} value={mir} onChange={(event) => setMir(event.target.value)}>
              <option value="">Всички</option>
              {mirs.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label} ({item.count})
                </option>
              ))}
            </select>
          </label>
        </div>
        {people.length === 0 ? (
          <p className="text-sm text-[#333]">Няма хора с публикувана секция за този филтър.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-2 border-[#2b062f]">
                  <th className="px-2 py-2">№</th>
                  <th className="px-2 py-2">Име</th>
                  <th className="px-2 py-2">Секция</th>
                  <th className="px-2 py-2">МИР</th>
                  <th className="px-2 py-2">Генерирано</th>
                  <th className="px-2 py-2">Подписано</th>
                </tr>
              </thead>
              <tbody>
                {people.map((row) => (
                  <tr key={row.id} className="border-b border-[#e7dce9]">
                    <td className="px-2 py-2">{row.number ?? '—'}</td>
                    <td className="px-2 py-2 font-bold">{row.name}</td>
                    <td className="px-2 py-2">{row.section}</td>
                    <td className="px-2 py-2">{row.mir}</td>
                    <td className="px-2 py-2">{formatWhen(row.generatedAt)}</td>
                    <td className="px-2 py-2">
                      {row.driveUrl ? (
                        <a className="text-[#2b062f] underline" href={row.driveUrl} target="_blank" rel="noreferrer">
                          {formatWhen(row.signedAt)}
                        </a>
                      ) : (
                        formatWhen(row.signedAt)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {message ? <p className="text-sm font-bold text-[#1a1020]">{message}</p> : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1 rounded-2xl border-2 border-[#2b062f] bg-white p-4">
      <span className="text-sm font-bold">{label}</span>
      <span className="text-3xl font-black text-[#2b062f]">{value}</span>
    </div>
  )
}

function UploadPreview({ preview }: { preview: SignedUploadMatch }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-bold text-[#1a1020]">
        Съвпаднали {preview.matched.length}, без съвпадение {preview.unmatched.length}, дубликати {preview.duplicates.length}, не PDF{' '}
        {preview.notPdf.length}
      </p>
      <div className="overflow-auto">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-2 border-[#2b062f]">
              <th className="px-2 py-2">Файл</th>
              <th className="px-2 py-2">Статус</th>
              <th className="px-2 py-2">Човек</th>
            </tr>
          </thead>
          <tbody>
            {preview.matched.map((row) => (
              <PreviewRow key={`m-${row.fileName}`} fileName={row.fileName} status={matchedStatus(row)} person={`${row.number} · ${row.name}`} />
            ))}
            {preview.duplicates.map((row) => (
              <PreviewRow key={`d-${row.personId}`} fileName={row.fileNames.join(', ')} status="дубликат" person={`${row.number} · ${row.name}`} />
            ))}
            {preview.unmatched.map((row) => (
              <PreviewRow key={`u-${row.fileName}`} fileName={row.fileName} status={row.reason} person="—" />
            ))}
            {preview.notPdf.map((row) => (
              <PreviewRow key={`n-${row.fileName}`} fileName={row.fileName} status={row.reason} person="—" />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function matchedStatus(row: MatchedUpload) {
  const bits = ['съвпадение']
  if (row.missingSigned) bits.push('без _signed')
  if (row.willReplace) bits.push('ще замени линка')
  return bits.join(' · ')
}

function PreviewRow({ fileName, status, person }: { fileName: string; status: string; person: string }) {
  return (
    <tr className="border-b border-[#e7dce9]">
      <td className="px-2 py-2">{fileName}</td>
      <td className="px-2 py-2">{status}</td>
      <td className="px-2 py-2">{person}</td>
    </tr>
  )
}

function formatWhen(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('bg-BG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Sofia' }).format(date)
}

async function readIncoming(list: FileList) {
  const files: Array<{ name: string; bytes: Uint8Array }> = []
  for (const file of list) {
    files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
  }
  return files
}

type UploadResultRow = { personId: string; fileName: string; person: string; drive: string; brevo: string; ok: boolean }

function UploadResults({ rows }: { rows: UploadResultRow[] }) {
  return (
    <div className="overflow-auto">
      <table aria-label="Резултат от качването" className="w-full min-w-[32rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b-2 border-[#2b062f]">
            <th className="px-2 py-2">Файл</th>
            <th className="px-2 py-2">Човек</th>
            <th className="px-2 py-2">Drive</th>
            <th className="px-2 py-2">Brevo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.personId} className={`border-b border-[#e7dce9] ${row.ok ? '' : 'text-[#8f1d1d]'}`}>
              <td className="px-2 py-2">{row.fileName}</td>
              <td className="px-2 py-2">{row.person}</td>
              <td className="px-2 py-2">{row.drive}</td>
              <td className="px-2 py-2">{row.brevo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type SyncResponse = Awaited<ReturnType<typeof adminDesignationSyncBrevo>>
type SyncFailure = { personId: string; error?: string }

/** Re-send every stored Drive link to Brevo, page by page, without uploading again. */
async function resyncAllSigned(onProgress: (line: string) => void) {
  let offset: number | null = 0
  let updated = 0
  const failures: SyncFailure[] = []
  let attribute = ''
  let lastMessage = ''
  while (offset !== null) {
    const sync: SyncResponse = await adminDesignationSyncBrevo({ data: { allSigned: true, offset } })
    lastMessage = sync.message
    if (!('results' in sync) || !Array.isArray(sync.results)) {
      return { summary: sync.message, failures }
    }
    attribute = 'attribute' in sync && typeof sync.attribute === 'string' ? sync.attribute : attribute
    for (const item of sync.results) {
      if (item.ok) updated += 1
      else failures.push({ personId: item.personId, error: item.error })
    }
    if (!sync.ok && sync.results.length === 0) return { summary: sync.message, failures }
    offset = 'nextOffset' in sync && typeof sync.nextOffset === 'number' ? sync.nextOffset : null
    if (offset !== null) onProgress(`Синхронизираме с Brevo… ${updated + failures.length} готови`)
  }
  if (!attribute) return { summary: lastMessage, failures }
  const reasons = [...new Set(failures.map((row) => row.error ?? 'грешка'))].slice(0, 3)
  const summary = `Brevo (${attribute}): ${updated} обновени / ${failures.length} грешки${reasons.length ? `: ${reasons.join('; ')}` : '.'}`
  return { summary, failures }
}

async function uploadMatched(rows: MatchedUpload[], onProgress: (line: string) => void) {
  const uploaded: MatchedUpload[] = []
  const failed: Array<{ row: MatchedUpload; error: string }> = []
  let index = 0
  const workers = Array.from({ length: Math.min(3, rows.length) }, async () => {
    while (index < rows.length) {
      const current = index
      index += 1
      const row = rows[current]!
      onProgress(`Качване ${current + 1} от ${rows.length}: ${row.name}`)
      try {
        const response = await fetch(`/admin/palnomoshtni/upload?personId=${encodeURIComponent(row.personId)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/pdf' },
          body: row.bytes as unknown as BodyInit,
          credentials: 'same-origin',
        })
        const json = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string }
        if (!response.ok || !json.ok) throw new Error(json.message || `Качването на ${row.fileName} се провали.`)
        uploaded.push(row)
      } catch (error) {
        failed.push({ row, error: error instanceof Error ? error.message : 'неизвестна грешка' })
      }
    }
  })
  await Promise.all(workers)
  return { uploaded, failed }
}

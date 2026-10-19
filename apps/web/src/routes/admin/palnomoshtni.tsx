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
        </div>
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
              void uploadMatched(preview.matched, (line) => setUploadProgress(line))
                .then(async (uploaded) => {
                  setUploadProgress(`Качени ${uploaded.length} от ${preview.matched.length}.`)
                  if (uploaded.length === 0) return
                  const sync = await adminDesignationSyncBrevo({ data: { personIds: uploaded.map((row) => row.personId) } })
                  const extra =
                    'rejected' in sync && Array.isArray(sync.rejected) && sync.rejected.length > 0
                      ? ` Отхвърлени: ${sync.rejected.join('; ')}`
                      : ''
                  setBrevoSummary(`${sync.message}${extra}`)
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
        {uploadProgress ? <p className="text-sm text-[#1a1020]">{uploadProgress}</p> : null}
        {brevoSummary ? <p className="text-sm font-bold text-[#1a1020]">{brevoSummary}</p> : null}
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

async function uploadMatched(rows: MatchedUpload[], onProgress: (line: string) => void) {
  const uploaded: MatchedUpload[] = []
  let index = 0
  const workers = Array.from({ length: Math.min(3, rows.length) }, async () => {
    while (index < rows.length) {
      const current = index
      index += 1
      const row = rows[current]!
      onProgress(`Качване ${current + 1} от ${rows.length}: ${row.name}`)
      const response = await fetch(`/admin/palnomoshtni/upload?personId=${encodeURIComponent(row.personId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/pdf' },
        body: row.bytes as unknown as BodyInit,
        credentials: 'same-origin',
      })
      const json = (await response.json()) as { ok?: boolean; message?: string }
      if (!response.ok || !json.ok) throw new Error(json.message || `Качването на ${row.fileName} се провали.`)
      uploaded.push(row)
    }
  })
  await Promise.all(workers)
  return uploaded
}

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
  expandUploadFilesDetailed,
  matchSignedFiles,
  signedUploadBlockReason,
  signedUploadPlan,
  toFilePerson,
  zipBatchPlan,
  type DesignationCounts,
  type DesignationMirOption,
  type DesignationPartnerCounts,
  type DesignationPersonView,
  type MatchedUpload,
  type SignedUploadMatch,
  type UploadProblem,
} from '../../signup/designation-files'
import {
  brevoCountsLine,
  uploadBrevoCell,
  uploadBrevoOf,
  uploadSummary,
  type BrevoStatus,
  type UploadBrevo,
} from '../../signup/designation-brevo-ui'
import { ELECTION_DISTRICTS } from '../../signup/designation-config'
import {
  SIGN_SCOPES,
  SIGN_SCOPE_HINTS,
  SIGN_SCOPE_LABELS,
  signScopeBatches,
  type SignScope,
  type SignScopeCounts,
} from '../../signup/designation-sign-scope'
import { postSignedPdf } from '../../signup/designation-upload-errors'
import { IAZ_LABEL, partnerBadge } from '../../signup/partner-import'
import { adminPartnerSetMir, adminPartnerWithdraw } from '../../signup/partner-import-admin'
import { COVERED_LABEL, WITHDRAWN_PARTNER_LABEL, duplicateBadge } from '../../signup/designation-duplicates'
import { PartnerImportPanel } from './-partner-import-panel'
import { PersonName } from './-person-name'
import { SignedWavesPanel } from './-signed-waves-panel'

export const Route = createFileRoute('/admin/palnomoshtni')({
  component: PalnomoshtniPage,
})

const EXPORT_REASON = 'Нужно е право за експорт (редактор или админ).'

function PalnomoshtniPage() {
  const access = useAdminAccess()
  const canExport = access.permissions.exportCampaign
  const canEdit = access.permissions.edit
  const canWithdraw = access.permissions.publish
  const [mir, setMir] = useState('')
  const [q, setQ] = useState('')
  const [counts, setCounts] = useState<DesignationCounts | null>(null)
  const [partnerCounts, setPartnerCounts] = useState<DesignationPartnerCounts | null>(null)
  const [people, setPeople] = useState<DesignationPersonView[]>([])
  const [mirs, setMirs] = useState<DesignationMirOption[]>([])
  const [zipEligible, setZipEligible] = useState(0)
  const [signScope, setSignScope] = useState<SignScope>('new')
  const [scopeCounts, setScopeCounts] = useState<SignScopeCounts | null>(null)
  const [partnerScopeCounts, setPartnerScopeCounts] = useState<SignScopeCounts | null>(null)
  const [volunteerScopeCounts, setVolunteerScopeCounts] = useState<SignScopeCounts | null>(null)
  const [healthLine, setHealthLine] = useState('Проверяваме Drive и Brevo…')
  const [canUploadDrive, setCanUploadDrive] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<SignedUploadMatch | null>(null)
  const [reading, setReading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [uploadTone, setUploadTone] = useState<BrevoStatus['tone']>('busy')
  const [brevoStatus, setBrevoStatus] = useState<BrevoStatus | null>(null)
  const [uploadRows, setUploadRows] = useState<UploadResultRow[]>([])
  const [resyncFailures, setResyncFailures] = useState<string[]>([])
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [retrying, setRetrying] = useState<string[]>([])

  const reload = useCallback(() => {
    void adminDesignationStatus({ data: { mir, q } }).then((result) => {
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setCounts(result.counts)
      setPartnerCounts(result.partnerCounts ?? null)
      setPeople(result.people)
      setMirs(result.mirs)
      setZipEligible(result.zipEligible)
      setScopeCounts('scopeCounts' in result && result.scopeCounts ? result.scopeCounts : null)
      setPartnerScopeCounts('partnerScopeCounts' in result && result.partnerScopeCounts ? result.partnerScopeCounts : null)
      setVolunteerScopeCounts('volunteerScopeCounts' in result && result.volunteerScopeCounts ? result.volunteerScopeCounts : null)
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
  // Older responses (and tests) without scope counts fall back to the full list.
  const scopeCount = scopeCounts ? scopeCounts[signScope] : zipEligible
  const batches = scopeCounts
    ? signScopeBatches(signScope, scopeCount, DESIGNATION_ZIP_BATCH_LIMIT)
    : zipBatchPlan(zipEligible, DESIGNATION_ZIP_BATCH_LIMIT)
  const scopeParam = scopeCounts ? `&scope=${signScope}` : ''
  // „N доброволци + M „И аз““ for one scope in this МИР filter (the ZIP holds both).
  const scopeSplit = (option: SignScope) =>
    scopeCounts && volunteerScopeCounts
      ? `${volunteerScopeCounts[option]} доброволци + ${scopeCounts[option] - volunteerScopeCounts[option]} „${IAZ_LABEL}“`
      : ''
  const partnerScopeCount = partnerScopeCounts ? partnerScopeCounts[signScope] : (partnerCounts?.numbered ?? 0)
  const partnerBatches = partnerScopeCounts
    ? signScopeBatches(signScope, partnerScopeCount, DESIGNATION_ZIP_BATCH_LIMIT)
    : zipBatchPlan(partnerCounts?.numbered ?? 0, DESIGNATION_ZIP_BATCH_LIMIT)
  // „Само новите“ shrinks once a ZIP is served; refresh the counts shortly after a click.
  const afterZipClick = () => {
    window.setTimeout(reload, 4000)
    window.setTimeout(reload, 15000)
  }
  const uploadBlockReason = signedUploadBlockReason({ canExport, canUploadDrive, busy, reading, preview, replaceExisting })
  const plan = preview ? signedUploadPlan(preview, replaceExisting) : null

  const retryRow = (row: UploadResultRow) => {
    const source = row.source
    if (!source) return
    setRetrying((list) => [...list, row.personId])
    void uploadOne(source, replaceExisting || source.willReplace)
      .then((result) => {
        setUploadRows((rows) => rows.map((item) => (item.personId === row.personId ? resultRow(source, result) : item)))
        if (result.status === 'uploaded') reload()
      })
      .finally(() => setRetrying((list) => list.filter((id) => id !== row.personId)))
  }

  const takeIncoming = (incoming: Promise<ReadIncoming>) => {
    setReading(true)
    setUploadProgress('')
    setUploadRows([])
    void incoming
      .then(({ files, problems }) => {
        if (files.length === 0 && problems.length === 0) {
          setPreview(null)
          return
        }
        const expanded = expandUploadFilesDetailed(files)
        setPreview(
          matchSignedFiles(expanded.files, numberedPeople, {
            problems: [...problems, ...expanded.problems],
            ignored: expanded.ignored,
          }),
        )
      })
      .catch((error) => {
        setPreview(null)
        setUploadTone('error')
        setUploadProgress(error instanceof Error ? `Файловете не се прочетоха: ${error.message}` : 'Файловете не се прочетоха.')
      })
      .finally(() => setReading(false))
  }

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
            <Stat label="Общо (секция или „И аз“)" value={counts.published} partner={counts.partner?.published} testId="stat-published" />
            <Stat label="Номерирани" value={counts.numbered} partner={counts.partner?.numbered} testId="stat-numbered" />
            <Stat label="Генерирани" value={counts.generated} partner={counts.partner?.generated} testId="stat-generated" />
            <Stat label="Подписани" value={counts.signed} partner={counts.partner?.signed} testId="stat-signed" />
            <Stat label="Без подписано пълномощно" value={counts.missing} partner={counts.partner?.missing} testId="missing-count">
              {counts.missingSteps ? (
                <ul className="grid gap-0.5 text-sm text-[#333]" data-testid="missing-steps">
                  <MissingStep label="без номер" value={counts.missingSteps.noNumber} partner={counts.partner?.missingSteps?.noNumber} />
                  <MissingStep
                    label="номерирани, неизтеглени за подпис"
                    value={counts.missingSteps.notDownloaded}
                    partner={counts.partner?.missingSteps?.notDownloaded}
                  />
                  <MissingStep
                    label="изтеглени, чакат подпис"
                    value={counts.missingSteps.awaitingSignature}
                    partner={counts.partner?.missingSteps?.awaitingSignature}
                  />
                </ul>
              ) : null}
            </Stat>
          </div>
          {counts.duplicates ? (
            <p className="text-sm font-bold text-[#8f1d1d]" data-testid="duplicate-count">
              Дубликати по ЕГН: {counts.duplicates}. Не влизат в ZIP за подпис, в „За подпис“ и в задачите за РИК, и не се номерират. Оттегли
              излишното пълномощно (бутон „Оттегли пълномощното“ при „{IAZ_LABEL}“).
            </p>
          ) : null}
          {partnerCounts && partnerCounts.total > 0 ? (
            <p className="text-sm text-[#333]" data-testid="partner-counts">
              „{IAZ_LABEL}“ не са записани доброволци и не отиват в Brevo (броят им е в „от тях „{IAZ_LABEL}““ горе)
              {partnerCounts.withdrawn ? `; оттеглени ${partnerCounts.withdrawn} (не се броят)` : ''}
              {partnerCounts.covered ? `; покрити от доброволец ${partnerCounts.covered}` : ''}
              {partnerCounts.noMir ? `; без МИР ${partnerCounts.noMir} (избери МИР в таблицата, за да получат номер)` : ''}.
              {partnerScopeCounts ? ` За подпис („${SIGN_SCOPE_LABELS[signScope]}“): ${partnerScopeCount}.` : ''}
              {canExport && partnerBatches.length > 0
                ? partnerBatches.map((batch) => (
                    <a
                      key={`iaz-${batch.offset}`}
                      className={`${adminGhost} ml-2`}
                      href={`/admin/palnomoshtni/zip?partner=1&offset=${batch.offset}&limit=${batch.limit}${scopeParam}`}
                      onClick={afterZipClick}
                    >
                      Изтегли ZIP „{IAZ_LABEL}“ {batch.from}–{batch.to}
                    </a>
                  ))
                : null}
            </p>
          ) : null}
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
          {scopeCounts ? (
            <fieldset className="grid gap-1" data-testid="sign-scope">
              <legend className="text-sm font-bold text-[#1a1020]">ZIP за подпис — кои</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {SIGN_SCOPES.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm text-[#1a1020]" title={SIGN_SCOPE_HINTS[option]}>
                    <input
                      type="radio"
                      name="sign-scope"
                      value={option}
                      checked={signScope === option}
                      onChange={() => setSignScope(option)}
                    />
                    {SIGN_SCOPE_LABELS[option]} ({scopeCounts[option]}{scopeSplit(option) ? `: ${scopeSplit(option)}` : ''})
                  </label>
                ))}
              </div>
              <p className="text-xs text-[#333]">
                {SIGN_SCOPE_HINTS[signScope]}
                {signScope === 'new' ? ' Всеки свален ZIP ги отбелязва, следващият дава следващите.' : ''}
              </p>
            </fieldset>
          ) : null}
          <p className="text-sm font-bold text-[#1a1020]" data-testid="zip-batch-line">
            ZIP партиди: {batches.length || 0}
            {scopeCount
              ? ` · ${scopeCount} ${scopeCounts ? `„${SIGN_SCOPE_LABELS[signScope]}“` : 'номерирани'}${scopeSplit(signScope) ? ` (${scopeSplit(signScope)})` : ''} в този филтър, по ${DESIGNATION_ZIP_BATCH_LIMIT}`
              : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {batches.length === 0 ? (
              <p className="text-sm text-[#333]">
                {scopeCounts ? `Няма хора за „${SIGN_SCOPE_LABELS[signScope]}“ в този филтър.` : 'Няма номерирани хора за ZIP в този филтър.'}
              </p>
            ) : (
              batches.map((batch) => {
                const href = `/admin/palnomoshtni/zip?mir=${encodeURIComponent(mir)}&offset=${batch.offset}&limit=${batch.limit}${scopeParam}`
                if (!canExport) {
                  return (
                    <button key={href} type="button" className={adminGhost} disabled title={EXPORT_REASON}>
                      Изтегли ZIP {batch.from}–{batch.to}
                    </button>
                  )
                }
                return (
                  <a key={href} className={adminGhost} href={href} onClick={afterZipClick}>
                    Изтегли ZIP {batch.from}–{batch.to}
                  </a>
                )
              })
            )}
          </div>
        </div>
      </section>

      <section id="i-az" aria-labelledby="partner-import-heading" className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-white p-4">
        {canEdit ? (
          <PartnerImportPanel onImported={reload} />
        ) : (
          <>
            <h2 id="partner-import-heading" className="text-lg font-black text-[#1a1020]">
              Внос от „{IAZ_LABEL}“
            </h2>
            <p className="text-sm font-bold text-[#8f1d1d]">Нужно е право за редакция (редактор или админ).</p>
          </>
        )}
      </section>

      <section
        aria-labelledby="palnomoshtni-upload"
        className={`grid gap-3 rounded-2xl border-2 bg-[#f6f1f7] p-4 ${dragOver ? 'border-dashed border-[#8f1d6b]' : 'border-[#2b062f]'}`}
        onDragOver={(event) => {
          if (!canExport || busy) return
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (!canExport || busy) return
          event.preventDefault()
          setDragOver(false)
          takeIncoming(readDropped(event.dataTransfer))
        }}
      >
        <h2 id="palnomoshtni-upload" className="text-lg font-black text-[#1a1020]">
          Качване на подписани
        </h2>
        <p className="text-sm text-[#333]">
          Избери PDF-и, ZIP или цяла папка (или ги пусни тук). ZIP може да има папки вътре и дори ZIP в ZIP; __MACOSX и .DS_Store се пропускат. Имената се съпоставят по файла ({'МИР_номер_Име_Презиме_Фамилия_signed.pdf'}; старият ASCII формат също се приема) без ЕГН. Дубликатите не се качват, докато не махнеш излишните.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="palnomoshtni-files">
            Подписани PDF или ZIP
            <input
              id="palnomoshtni-files"
              className={adminInput}
              type="file"
              accept=".pdf,.zip,application/pdf,application/zip,application/x-zip-compressed"
              multiple
              disabled={!canExport || busy}
              onChange={(event) => {
                const list = event.target.files
                if (!list || list.length === 0) {
                  setPreview(null)
                  return
                }
                const picked = [...list]
                // Clear the input so choosing the same file (or one PDF after a ZIP) always fires onChange.
                event.target.value = ''
                takeIncoming(readIncoming(picked))
              }}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="palnomoshtni-folder">
            Или папка с PDF-и
            <input
              id="palnomoshtni-folder"
              className={adminInput}
              type="file"
              multiple
              disabled={!canExport || busy}
              {...({ webkitdirectory: '' } as Record<string, string>)}
              onChange={(event) => {
                const list = event.target.files
                if (!list || list.length === 0) {
                  setPreview(null)
                  return
                }
                const picked = [...list]
                // Clear the input so choosing the same file (or one PDF after a ZIP) always fires onChange.
                event.target.value = ''
                takeIncoming(readIncoming(picked))
              }}
            />
          </label>
        </div>
        {preview ? <UploadPreview preview={preview} replaceExisting={replaceExisting} /> : null}
        {preview && preview.matched.some((row) => row.willReplace) ? (
          <label className="flex items-center gap-2 text-sm font-bold text-[#1a1020]">
            <input type="checkbox" checked={replaceExisting} disabled={busy} onChange={(event) => setReplaceExisting(event.target.checked)} />
            Замени и вече качените ({preview.matched.filter((row) => row.willReplace).length})
          </label>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={adminGhost}
            disabled={Boolean(uploadBlockReason) || busy || !plan || plan.toUpload.length === 0}
            title={uploadBlockReason || undefined}
            aria-describedby={uploadBlockReason ? 'palnomoshtni-upload-block' : undefined}
            onClick={() => {
              if (!preview) return
              setBusy(true)
              setMessage('')
              setBrevoStatus(null)
              setResyncFailures([])
              setUploadRows([])
              setUploadTone('busy')
              const { toUpload, already } = signedUploadPlan(preview, replaceExisting)
              // Each upload also puts the new Drive link on the Brevo contact (DOCUMENT_URL) on the server.
              void uploadMatched(toUpload, replaceExisting, (line) => setUploadProgress(line))
                .then((results) => {
                  const rows = toUpload.map((row, index) => resultRow(row, results[index]!))
                  setUploadRows(rows)
                  const uploaded = results.filter((item) => item.status === 'uploaded')
                  const skipped = already.length + results.filter((item) => item.status === 'skipped').length
                  const failed = results.filter((item) => item.status === 'failed').length
                  const summary = uploadSummary(
                    toUpload.length - (skipped - already.length),
                    uploaded.map((item) => (item.status === 'uploaded' ? item.brevo : null)).filter((item): item is UploadBrevo => item !== null),
                  )
                  const extra = [
                    skipped ? `Вече качени ${skipped} (пропуснати).` : '',
                    failed ? `Неуспешни ${failed}: натисни „Опитай пак“ на реда.` : '',
                  ].filter(Boolean)
                  const allSkipped = uploaded.length === 0 && failed === 0 && skipped > 0
                  setUploadTone(failed ? 'error' : allSkipped ? 'ok' : summary.tone)
                  setUploadProgress([summary.text, ...extra].join(' '))
                  reload()
                })
                .catch((error) => {
                  setUploadTone('error')
                  setUploadProgress(error instanceof Error ? `Качването се провали: ${error.message}` : 'Качването се провали.')
                })
                .finally(() => setBusy(false))
            }}
          >
            {plan ? `Качи ${plan.toUpload.length} подписани` : 'Качи подписани'}
          </button>
          {uploadBlockReason ? (
            <p id="palnomoshtni-upload-block" data-testid="upload-block-reason" className="text-sm font-bold text-[#8f1d1d]">
              {uploadBlockReason}
            </p>
          ) : null}
        </div>
        {uploadProgress ? (
          <p role="status" aria-live="polite" className={`text-sm font-bold ${toneClass(uploadTone)}`}>
            {uploadProgress}
          </p>
        ) : null}
        {uploadRows.length > 0 ? <UploadResults rows={uploadRows} retrying={retrying} onRetry={retryRow} disabled={busy} /> : null}
      </section>

      <SignedWavesPanel canExport={canExport} refreshKey={signedCount} />

      <section aria-labelledby="palnomoshtni-brevo" className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-white p-4">
        <h2 id="palnomoshtni-brevo" className="text-lg font-black text-[#1a1020]">
          Синхрон с Brevo
        </h2>
        <p className="text-sm text-[#333]">
          Качването вече праща линка към Brevo ({'DOCUMENT_URL'}). Този бутон праща наново само подписаните активни доброволци ({signedCount}) с линка и секцията. Неподписаните и отказалите се не се пращат. Само обновява контакти, без имейли.
          Хората от „{IAZ_LABEL}“ никога не отиват в Brevo.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={adminGhost}
            disabled={!canExport || busy || signedCount === 0}
            title={!canExport ? EXPORT_REASON : 'Праща наново линка и секцията на подписаните активни доброволци, без да качваш файловете.'}
            onClick={() => {
              setBusy(true)
              setMessage('')
              setBrevoStatus({ tone: 'busy', text: 'Синхронизираме с Brevo…' })
              setResyncFailures([])
              const names = new Map(people.map((row) => [row.id, `${row.number ?? '—'} · ${row.name}`]))
              void resyncAllSigned((line) => setBrevoStatus({ tone: 'busy', text: line }))
                .then(({ summary, failures, ok }) => {
                  setBrevoStatus({ tone: ok ? 'ok' : 'error', text: summary })
                  setResyncFailures(failures.map((row) => `${names.get(row.personId) ?? row.personId}: ${row.error ?? 'грешка'}`))
                })
                .catch((error) =>
                  setBrevoStatus({
                    tone: 'error',
                    text: error instanceof Error ? `Brevo синхронът се провали: ${error.message}` : 'Brevo синхронът се провали.',
                  }),
                )
                .finally(() => setBusy(false))
            }}
          >
            Синхронизирай с Brevo
          </button>
          {canExport && signedCount === 0 ? <p className="text-sm text-[#333]">Още няма качени подписани пълномощни.</p> : null}
        </div>
        {brevoStatus ? (
          <p role="status" aria-live="polite" aria-label="Резултат от синхрона с Brevo" className={`text-sm font-bold ${toneClass(brevoStatus.tone)}`}>
            {brevoStatus.text}
          </p>
        ) : null}
        {resyncFailures.length > 0 ? (
          <ul aria-label="Грешки при синхрон с Brevo" className="list-disc pl-5 text-sm text-[#8f1d1d]">
            {resyncFailures.slice(0, 50).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
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
                  <th className="px-2 py-2">
                    <span className="sr-only">Действие</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((row) => (
                  <tr key={row.id} className="border-b border-[#e7dce9]">
                    <td className="px-2 py-2">{row.number ?? '—'}</td>
                    <td className="px-2 py-2 font-bold">
                      {row.partner ? row.name : <PersonName id={row.id} name={row.name} />}
                      {partnerBadge(row.partner) ? (
                        <span className="ml-2 rounded-full border border-[#2b062f] bg-[#f4e4b3] px-2 py-0.5 text-xs font-bold text-[#1a1020]">
                          {partnerBadge(row.partner)}
                        </span>
                      ) : null}
                      {row.withdrawnAt ? (
                        <span
                          className="ml-2 rounded-full border border-[#8f1d1d] bg-[#f7dede] px-2 py-0.5 text-xs font-bold text-[#8f1d1d]"
                          data-testid="withdrawn-badge"
                          title={row.withdrawnReason || undefined}
                        >
                          {WITHDRAWN_PARTNER_LABEL}
                          {row.withdrawnReason ? `: ${row.withdrawnReason}` : ''}
                        </span>
                      ) : null}
                      {row.duplicateOf ? (
                        <span
                          className="ml-2 rounded-full border border-[#8f1d1d] bg-[#f7dede] px-2 py-0.5 text-xs font-bold text-[#8f1d1d]"
                          data-testid="duplicate-badge"
                        >
                          {duplicateBadge({ ...row.duplicateOf, keeperId: '' })}
                          {row.duplicateOf.mir && row.duplicateOf.mir !== row.mir ? ` (МИР ${row.duplicateOf.mir})` : ''}
                        </span>
                      ) : null}
                      {row.covered ? (
                        <span className="ml-2 rounded-full border border-[#2b062f] bg-[#efe8f2] px-2 py-0.5 text-xs font-bold text-[#1a1020]" data-testid="covered-badge">
                          {COVERED_LABEL}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">{row.partner ? '—' : row.section}</td>
                    <td className="px-2 py-2">
                      {row.partner && row.number == null ? (
                        <PartnerMirSelect id={row.id} mir={row.mir} disabled={!canEdit || busy} onSaved={reload} setMessage={setMessage} />
                      ) : (
                        row.mir || '—'
                      )}
                    </td>
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
                    <td className="px-2 py-2">
                      {row.partner && !row.withdrawnAt && canWithdraw ? (
                        <PartnerWithdraw id={row.id} number={row.number} disabled={busy} onDone={reload} setMessage={setMessage} />
                      ) : null}
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

/** Withdraw one „И аз“ пълномощно, with a reason (admins). Number and МИР stay; Drive is not touched. */
function PartnerWithdraw({
  id,
  number,
  disabled,
  onDone,
  setMessage,
}: {
  id: string
  number: number | null
  disabled: boolean
  onDone: () => void
  setMessage: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  if (!open) {
    return (
      <button type="button" className={adminGhost} disabled={disabled} onClick={() => setOpen(true)}>
        Оттегли пълномощното
      </button>
    )
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!reason.trim()) return
        setSaving(true)
        void adminPartnerWithdraw({ data: { id, reason } })
          .then((result) => {
            setMessage(result.message)
            if (result.ok) {
              setOpen(false)
              onDone()
            }
          })
          .finally(() => setSaving(false))
      }}
    >
      <label className="grid gap-1 text-xs font-bold text-[#1a1020]">
        Причина{number != null ? ` (№ ${number})` : ''}
        <input className={adminInput} value={reason} maxLength={300} required onChange={(event) => setReason(event.target.value)} />
      </label>
      <button type="submit" className={adminGhost} disabled={saving || !reason.trim()}>
        Потвърди оттеглянето
      </button>
      <button type="button" className={adminGhost} disabled={saving} onClick={() => setOpen(false)}>
        Откажи
      </button>
    </form>
  )
}

/** МИР for an „И аз“ person before numbering; the file may not say it (София без район). */
function PartnerMirSelect({
  id,
  mir,
  disabled,
  onSaved,
  setMessage,
}: {
  id: string
  mir: string
  disabled: boolean
  onSaved: () => void
  setMessage: (text: string) => void
}) {
  return (
    <select
      aria-label="МИР за пълномощното"
      className={adminInput}
      value={mir}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value
        if (!next) return
        void adminPartnerSetMir({ data: { id, mir: next } }).then((result) => {
          setMessage(result.message)
          if (result.ok) onSaved()
        })
      }}
    >
      <option value="">Няма МИР</option>
      {Object.entries(ELECTION_DISTRICTS)
        .filter(([code]) => code !== '32')
        .map(([code, name]) => (
          <option key={code} value={code}>
            {code} {name}
          </option>
        ))}
    </select>
  )
}

function Stat({ label, value, partner, testId, children }: { label: string; value: number; partner?: number; testId?: string; children?: ReactNode }) {
  return (
    <div className="grid content-start gap-1 rounded-2xl border-2 border-[#2b062f] bg-white p-4" data-testid={testId}>
      <span className="text-sm font-bold">{label}</span>
      <span className="text-3xl font-black text-[#2b062f]">{value}</span>
      {partner != null ? (
        <span className="text-xs text-[#333]" data-testid={testId ? `${testId}-partner` : undefined}>
          от тях „{IAZ_LABEL}“: {partner}
        </span>
      ) : null}
      {children}
    </div>
  )
}

function MissingStep({ label, value, partner }: { label: string; value: number; partner?: number }) {
  return (
    <li>
      {label}: {value}
      {partner ? <span className="text-xs"> (от тях „{IAZ_LABEL}“: {partner})</span> : null}
    </li>
  )
}

function UploadPreview({ preview, replaceExisting }: { preview: SignedUploadMatch; replaceExisting: boolean }) {
  const already = replaceExisting ? 0 : preview.matched.filter((row) => row.willReplace).length
  return (
    <div className="grid gap-2">
      <p className="text-sm font-bold text-[#1a1020]">
        Съвпаднали {preview.matched.length}, без съвпадение {preview.unmatched.length}, дубликати {preview.duplicates.length}, не PDF{' '}
        {preview.notPdf.length}
        {preview.ignored ? `, пропуснати системни файлове ${preview.ignored}` : ''}
      </p>
      {already ? (
        <p className="text-sm font-bold text-[#1d5f2f]" data-testid="already-uploaded">
          Вече качени {already}: пропускат се (качването на целия ZIP наново не дублира файлове).
        </p>
      ) : null}
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
              <PreviewRow key={`m-${row.fileName}`} fileName={row.fileName} status={matchedStatus(row, replaceExisting)} person={<>{row.number} · <PersonName id={row.personId} name={row.name} /></>} />
            ))}
            {preview.duplicates.map((row) => (
              <PreviewRow key={`d-${row.personId}`} fileName={row.fileNames.join(', ')} status="дубликат" person={<>{row.number} · <PersonName id={row.personId} name={row.name} /></>} />
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

function matchedStatus(row: MatchedUpload, replaceExisting: boolean) {
  const bits = ['съвпадение']
  if (row.missingSigned) bits.push('без _signed')
  if (row.willReplace) bits.push(replaceExisting ? 'ще замени файла' : 'вече качен: пропуска се')
  return bits.join(' · ')
}

function PreviewRow({ fileName, status, person }: { fileName: string; status: string; person: ReactNode }) {
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

type ReadIncoming = { files: Array<{ name: string; bytes: Uint8Array }>; problems: UploadProblem[] }

const UNREADABLE_REASON = 'не се чете: ако е папка, избери „Или папка с PDF-и“ или я пусни тук; иначе я компресирай в ZIP'

/** One unreadable item (a folder dropped on the file input reads as a File that throws) must not hide the rest. */
async function readIncoming(list: Array<File & { webkitRelativePath?: string }>): Promise<ReadIncoming> {
  const settled = await Promise.allSettled(list.map(async (file) => new Uint8Array(await file.arrayBuffer())))
  const out: ReadIncoming = { files: [], problems: [] }
  settled.forEach((result, index) => {
    const file = list[index]!
    const name = file.webkitRelativePath || file.name
    if (result.status === 'fulfilled') out.files.push({ name, bytes: result.value })
    else out.problems.push({ fileName: name, reason: UNREADABLE_REASON })
  })
  return out
}

type FsEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
  file?: (ok: (file: File) => void, fail: (error: unknown) => void) => void
  createReader?: () => { readEntries: (ok: (entries: FsEntry[]) => void, fail: (error: unknown) => void) => void }
}

/** Drag and drop keeps folders: walk them (any depth) so a dropped „Signed“ folder works like its ZIP. */
async function readDropped(transfer: DataTransfer): Promise<ReadIncoming> {
  const items = [...transfer.items].filter((item) => item.kind === 'file')
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? (item.webkitGetAsEntry() as unknown as FsEntry | null) : null))
    .filter((entry): entry is FsEntry => Boolean(entry))
  if (entries.length === 0) return readIncoming([...transfer.files])
  const out: ReadIncoming = { files: [], problems: [] }
  const walk = async (entry: FsEntry): Promise<void> => {
    const path = entry.fullPath.replace(/^\//, '') || entry.name
    if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader()
      for (;;) {
        const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail))
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
      return
    }
    if (!entry.file) return
    try {
      const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail))
      out.files.push({ name: path, bytes: new Uint8Array(await file.arrayBuffer()) })
    } catch {
      out.problems.push({ fileName: path, reason: UNREADABLE_REASON })
    }
  }
  for (const entry of entries) await walk(entry)
  return out
}

type UploadResultRow = {
  personId: string
  fileName: string
  number: number
  name: string
  drive: string
  brevo: string
  ok: boolean
  /** Kept only for failed rows: the bytes for „Опитай пак“ without picking the file again. */
  source?: MatchedUpload
}

type UploadOutcome =
  | { status: 'uploaded'; brevo: UploadBrevo }
  | { status: 'skipped' }
  | { status: 'failed'; error: string; retryable: boolean }

function resultRow(row: MatchedUpload, result: UploadOutcome): UploadResultRow {
  const base = { personId: row.personId, fileName: row.fileName, number: row.number, name: row.name }
  if (result.status === 'uploaded') {
    return { ...base, drive: row.willReplace ? 'заменен' : 'качен', brevo: uploadBrevoCell(result.brevo), ok: result.brevo.ok }
  }
  if (result.status === 'skipped') return { ...base, drive: 'вече качен: пропуснат', brevo: '—', ok: true }
  return { ...base, drive: `грешка: ${result.error}`, brevo: '—', ok: false, source: row }
}

function UploadResults({
  rows,
  retrying,
  onRetry,
  disabled,
}: {
  rows: UploadResultRow[]
  retrying: string[]
  onRetry: (row: UploadResultRow) => void
  disabled: boolean
}) {
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
              <td className="px-2 py-2">
                {row.number} · <PersonName id={row.personId} name={row.name} />
              </td>
              <td className="px-2 py-2">
                {row.drive}
                {row.source ? (
                  <button
                    type="button"
                    className={`${adminGhost} ml-2`}
                    disabled={disabled || retrying.includes(row.personId)}
                    onClick={() => onRetry(row)}
                  >
                    {retrying.includes(row.personId) ? 'Опитваме…' : 'Опитай пак'}
                  </button>
                ) : null}
              </td>
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

function toneClass(tone: BrevoStatus['tone']) {
  if (tone === 'ok') return 'text-[#1d5f2f]'
  if (tone === 'error') return 'text-[#8f1d1d]'
  return 'text-[#1a1020]'
}

/** Re-send every stored Drive link to Brevo, page by page, without uploading again. */
async function resyncAllSigned(onProgress: (line: string) => void) {
  let offset: number | null = 0
  let updated = 0
  let total: number | undefined
  const failures: SyncFailure[] = []
  let attribute = ''
  while (offset !== null) {
    const sync: SyncResponse = await adminDesignationSyncBrevo({ data: { allSigned: true, offset } })
    if (!('results' in sync) || !Array.isArray(sync.results)) {
      return { ok: false, summary: sync.message || 'Brevo синхронът не върна резултат.', failures }
    }
    attribute = 'attribute' in sync && typeof sync.attribute === 'string' ? sync.attribute : attribute
    if ('total' in sync && typeof sync.total === 'number') total = sync.total
    for (const item of sync.results) {
      if (item.ok) updated += 1
      else failures.push({ personId: item.personId, error: item.error })
    }
    if (!sync.ok && sync.results.length === 0) return { ok: false, summary: sync.message, failures }
    offset = 'nextOffset' in sync && typeof sync.nextOffset === 'number' ? sync.nextOffset : null
    if (offset !== null) onProgress(`Синхронизираме с Brevo… ${updated + failures.length}${total ? ` от ${total}` : ''} готови`)
  }
  const summary = brevoCountsLine(attribute, updated, failures.map((row) => row.error ?? 'грешка'), total)
  return { ok: failures.length === 0, summary, failures }
}

/** One PDF with backoff on transient failures (Drive 429/5xx, dropped D1 connection, no response). */
async function uploadOne(row: MatchedUpload, replace: boolean): Promise<UploadOutcome> {
  const result = await postSignedPdf({ personId: row.personId, bytes: row.bytes, replace })
  if (!result.ok) return { status: 'failed', error: result.message, retryable: result.retryable }
  if (result.body.skipped === true) return { status: 'skipped' }
  return { status: 'uploaded', brevo: uploadBrevoOf(result.body) }
}

async function uploadMatched(rows: MatchedUpload[], replace: boolean, onProgress: (line: string) => void) {
  const results: UploadOutcome[] = new Array(rows.length)
  let index = 0
  const workers = Array.from({ length: Math.min(3, rows.length) }, async () => {
    while (index < rows.length) {
      const current = index
      index += 1
      const row = rows[current]!
      onProgress(`Качване ${current + 1} от ${rows.length}: ${row.name}`)
      results[current] = await uploadOne(row, replace)
    }
  })
  await Promise.all(workers)
  return results
}

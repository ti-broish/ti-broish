import { useState } from 'react'
import { adminChipOn, adminGhost, adminInput } from '../../components/admin-ui'
import { IAZ_LABEL, type PlanKind, type PreviewRow } from '../../signup/partner-import'
import { adminPartnerImport } from '../../signup/partner-import-admin'

type Preview = {
  committed: boolean
  written: number
  counts: Record<PlanKind, number>
  total: number
  summary: string
  mapping: ReadonlyArray<{ column: string; field: string }>
  rows: PreviewRow[]
}

const KIND_LABEL: Record<PlanKind, string> = {
  new: 'Нови',
  tag: 'Вече записани (само етикет)',
  already: `Вече с „${IAZ_LABEL}“`,
  repeat: 'Повторени във файла',
  invalid: 'Невалидни',
}

const KIND_ORDER: PlanKind[] = ['new', 'tag', 'already', 'repeat', 'invalid']

function sofiaTime(iso: string) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

/** Upload → dry run → confirm. Nobody gets a letter: the import only writes rows and tags. */
export function PartnerImportPanel({ onImported }: { onImported: () => void }) {
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  function run(text: string, commit: boolean) {
    setBusy(true)
    setMessage('')
    void adminPartnerImport({ data: { csv: text, commit } })
      .then((result) => {
        setBusy(false)
        if (!result.ok) {
          setMessage(result.message)
          setPreview(null)
          return
        }
        setPreview(result)
        if (commit) {
          setMessage(`Готово. Внесени ${result.counts.new} нови, отбелязани ${result.counts.tag} вече записани. Писма не са пращани.`)
          onImported()
        }
      })
      .catch(() => {
        setBusy(false)
        setMessage('Вносът не мина. Опитай пак.')
      })
  }

  const writes = preview ? preview.counts.new + preview.counts.tag : 0

  return (
    <section className="grid gap-3" aria-labelledby="partner-import-heading">
      <h2 id="partner-import-heading" className="text-lg font-black text-[#1a1020]">
        Внос от партньор „{IAZ_LABEL}“
      </h2>
      <p className="text-sm text-[#333]">
        CSV с точка и запетая: Име;Имейл;ЕГН;Телефон;Област;Общини;IP;Подадено. Първо виждаш проверка без запис. Вече записаните
        не се променят, само получават етикета „{IAZ_LABEL}“. Повторното качване на същия файл не създава нови хора. Никой не получава
        писмо. IP не се пази.
      </p>
      <input
        className={`${adminInput} w-full`}
        type="file"
        accept=".csv,text/csv"
        aria-label={`CSV от „${IAZ_LABEL}“`}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setFileName(file.name)
          void file.text().then((text) => {
            setCsv(text)
            run(text, false)
          })
        }}
      />
      {busy ? <p className="text-sm font-bold text-[#1a1020]" role="status">Проверяваме файла…</p> : null}
      {message ? (
        <p className="text-sm font-bold text-[#1a1020]" role="status">
          {message}
        </p>
      ) : null}
      {preview ? (
        <div className="grid gap-3 rounded-2xl border-2 border-[#2b062f] p-4" data-testid="partner-import-preview">
          <p className="text-sm font-black text-[#1a1020]">
            {preview.committed ? 'Записано' : 'Проверка без запис'}
            {fileName ? ` · ${fileName}` : ''}
          </p>
          <p className="text-sm text-[#1a1020]">{preview.summary}</p>
          <ul className="flex flex-wrap gap-2 text-sm" aria-label="Обобщение">
            {KIND_ORDER.map((kind) => (
              <li key={kind} className="rounded-full bg-[#efe8f2] px-3 py-1 font-bold text-[#1a1020]">
                {KIND_LABEL[kind]}: {preview.counts[kind]}
              </li>
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer text-sm font-bold text-[#1a1020]">Как се попълват полетата</summary>
            <table className="mt-2 w-full text-left text-sm text-[#1a1020]">
              <tbody>
                {preview.mapping.map((item) => (
                  <tr key={item.column} className="border-b border-[#cfc3d2] align-top">
                    <th scope="row" className="py-1 pr-3 font-bold">
                      {item.column}
                    </th>
                    <td className="py-1">{item.field}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {KIND_ORDER.map((kind) => {
            const rows = preview.rows.filter((row) => row.kind === kind)
            if (!rows.length) return null
            return (
              <details key={kind} open={kind === 'invalid' || kind === 'tag'}>
                <summary className="cursor-pointer text-sm font-bold text-[#1a1020]">
                  {KIND_LABEL[kind]} ({rows.length})
                </summary>
                <div className="overflow-x-auto">
                  <table className="mt-2 w-full min-w-[720px] text-left text-sm text-[#1a1020]">
                    <thead>
                      <tr className="border-b-2 border-[#2b062f]">
                        <th className="py-1 pr-2">Ред</th>
                        <th className="py-1 pr-2">Човек</th>
                        <th className="py-1 pr-2">Имейл</th>
                        <th className="py-1 pr-2">ЕГН</th>
                        <th className="py-1 pr-2">Телефон</th>
                        <th className="py-1 pr-2">Място</th>
                        <th className="py-1 pr-2">Подадено</th>
                        <th className="py-1">Бележка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${kind}-${row.line}`} className="border-b border-[#cfc3d2] align-top">
                          <td className="py-1 pr-2">{row.line}</td>
                          <td className="py-1 pr-2">{row.name || '—'}</td>
                          <td className="py-1 pr-2">{row.email || '—'}</td>
                          <td className="py-1 pr-2 font-mono">{row.egn || '—'}</td>
                          <td className="py-1 pr-2">{row.phone || '—'}</td>
                          <td className="py-1 pr-2">{row.place || '—'}</td>
                          <td className="py-1 pr-2">{sofiaTime(row.submittedAt)}</td>
                          <td className="py-1">{[...row.reasons, ...row.warnings].join('; ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )
          })}
          {!preview.committed ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={adminChipOn} disabled={busy || writes === 0} onClick={() => run(csv, true)}>
                Потвърди вноса ({preview.counts.new} нови, {preview.counts.tag} с етикет)
              </button>
              <button
                type="button"
                className={adminGhost}
                disabled={busy}
                onClick={() => {
                  setPreview(null)
                  setCsv('')
                  setFileName('')
                }}
              >
                Откажи
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

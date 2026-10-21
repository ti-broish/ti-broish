import { useState } from 'react'
import { adminChipOn, adminGhost, adminInput } from '../../components/admin-ui'
import { IAZ_LABEL, type PlanKind, type PreviewRow } from '../../signup/partner-import'
import { adminPartnerImport } from '../../signup/partner-import-admin'

type Preview = {
  committed: boolean
  written: number
  counts: Record<PlanKind, number> & { alsoSignup: number; noMir: number; covered?: number }
  total: number
  summary: string
  mapping: ReadonlyArray<{ column: string; field: string }>
  rows: PreviewRow[]
}

const KIND_LABEL: Record<PlanKind, string> = {
  new: 'Нови',
  already: 'Вече внесени (дубликати)',
  repeat: 'Повторени във файла',
  invalid: 'Невалидни',
}

const KIND_ORDER: PlanKind[] = ['new', 'already', 'repeat', 'invalid']

const SIGNUP_LABEL = { egn: 'ЕГН', email: 'имейл', both: 'ЕГН и имейл' } as const

/**
 * Upload → dry run → confirm. People go only to the „И аз“ list for пълномощни: they are not
 * signups and never go to Brevo. Nobody gets a letter.
 */
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
          setMessage(`Готово. Внесени ${result.written} нови в „${IAZ_LABEL}“. Писма не са пращани, нищо не е пратено към Brevo.`)
          onImported()
        }
      })
      .catch(() => {
        setBusy(false)
        setMessage('Вносът не мина. Опитай пак.')
      })
  }

  const writes = preview ? preview.counts.new : 0

  return (
    <section className="grid gap-3" aria-labelledby="partner-import-heading">
      <h2 id="partner-import-heading" className="text-lg font-black text-[#1a1020]">
        Внос от „{IAZ_LABEL}“
      </h2>
      <p className="text-sm text-[#333]">
        CSV с точка и запетая: Име;Имейл;ЕГН;Телефон;Област;Общини;IP;Подадено. Хората влизат само в този списък за пълномощни: не
        стават записани доброволци, не се броят, не се разпределят и не отиват в Brevo. Никой не получава писмо. Първо виждаш проверка
        без запис. Вече внесените (същото ЕГН) не се променят, затова повторното качване е безопасно. Ако някой е и записан
        доброволец, това се показва, но записите не се сливат. IP не се пази.
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
            <li className="rounded-full bg-[#f4e4b3] px-3 py-1 font-bold text-[#1a1020]">И записани доброволци: {preview.counts.alsoSignup}</li>
            <li className="rounded-full bg-[#f4e4b3] px-3 py-1 font-bold text-[#1a1020]">Нови без МИР: {preview.counts.noMir}</li>
            <li className="rounded-full bg-[#f4e4b3] px-3 py-1 font-bold text-[#1a1020]" title="Същото ЕГН е на активен доброволец: внасят се за историята, но не се номерират (доброволецът има пълномощното).">
              Покрити от доброволец (без номер): {preview.counts.covered ?? 0}
            </li>
          </ul>
          {preview.counts.covered ? (
            <p className="text-sm font-bold text-[#8f1d1d]" data-testid="partner-import-covered">
              {preview.counts.covered} {preview.counts.covered === 1 ? 'човек вече е записан доброволец' : 'души вече са записани доброволци'} със същото ЕГН: внасят се като „покрит от доброволец“ и няма да получат номер, за да няма две пълномощни за един човек.
            </p>
          ) : null}
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
              <details key={kind} open={kind === 'invalid'}>
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
                        <th className="py-1 pr-2">МИР</th>
                        <th className="py-1 pr-2">Място</th>
                        <th className="py-1 pr-2">И записан</th>
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
                          <td className="py-1 pr-2">{row.mir || '—'}</td>
                          <td className="py-1 pr-2">{row.place || '—'}</td>
                          <td className="py-1 pr-2">
                            {row.signup ? `да (${SIGNUP_LABEL[row.signup]})` : '—'}
                            {row.covered ? (
                              <span className="ml-1 rounded-full border border-[#2b062f] bg-[#f4e4b3] px-2 py-0.5 text-xs font-bold">покрит от доброволец</span>
                            ) : null}
                          </td>
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
                Потвърди вноса ({preview.counts.new} нови)
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

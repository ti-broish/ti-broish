import { useEffect, useState } from 'react'
import { adminBrevoStatus, adminBrevoSyncSections } from '../../signup/admin-brevo'
import { BrevoHealthSummary } from './-brevo-health'
import { BrevoListSelect } from './-brevo-list-select'
import { brevoContactCount, brevoSyncPreviewText } from '../../signup/brevo-lists'

const ghost =
  'inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[#2b062f] bg-white px-4 text-sm font-bold text-[#2b062f]'

export function BrevoSyncPanel(props: {
  filters: { view: string; mir: string; q: string }
  scopeLabel: string
  setMessage: (message: string) => void
}) {
  const { filters, scopeLabel, setMessage } = props
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [listId, setListId] = useState('')
  const [listName, setListName] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{
    total: number
    listId: number
    listName: string
    samples: string[]
    lackingSection: number
    lackingSms: number
  } | null>(null)
  const [result, setResult] = useState<string>('')

  useEffect(() => {
    void adminBrevoStatus().then((status) => {
      if (!status.ok) return
      setConfigured(status.configured)
      if (status.configured && status.listId && !listId) setListId(String(status.listId))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section aria-labelledby="brevo-sync" className="grid gap-2 rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] p-4">
      <h2 id="brevo-sync" className="text-lg font-black text-[#1a1020]">
        Brevo: директна синхронизация
      </h2>
      <p className="text-sm text-[#333]">
        Обновява контактите в Brevo по EMAIL със същите атрибути като CSV. Не създава кампании и не праща имейли.
      </p>
      <p className="text-sm font-bold text-[#1a1020]">{scopeLabel}</p>
      {configured === false ? (
        <p className="text-sm text-[#a33]">Липсва BREVO_API_KEY. Дотогава ползвай CSV експорта.</p>
      ) : (
        <>
          <BrevoHealthSummary />
          {configured === true ? (
            <BrevoListSelect
              value={listId}
              disabled={busy}
              onChange={(next, name) => {
                setListId(next)
                setListName(name)
                setPreview(null)
              }}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={ghost}
              disabled={busy || configured !== true}
              onClick={() => {
                setBusy(true)
                setResult('')
                void adminBrevoSyncSections({
                  data: { ...filters, listId, dryRun: true },
                })
                  .then((response) => {
                    if (!response.ok) {
                      setMessage(response.message)
                      setPreview(null)
                      return
                    }
                    if (!response.dryRun) return
                    // Prefer the dropdown's name: it disambiguates duplicate list names with „ · #id“.
                    const name = String(response.listId) === listId && listName ? listName : response.listName
                    setPreview({
                      total: response.total,
                      listId: response.listId,
                      listName: name,
                      samples: response.samples,
                      lackingSection: response.lackingSection,
                      lackingSms: response.lackingSms,
                    })
                    setMessage(brevoSyncPreviewText(response.total, name))
                  })
                  .finally(() => setBusy(false))
              }}
            >
              {busy ? 'Проверявам…' : 'Провери колко'}
            </button>
            {preview ? (
              <button
                type="button"
                className="brand-button w-auto px-6"
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Синхронизирай ${brevoContactCount(preview.total)} към списък „${preview.listName}“ в Brevo? Това само обновява атрибути — без имейли.`,
                    )
                  ) {
                    return
                  }
                  setBusy(true)
                  void adminBrevoSyncSections({
                    data: { ...filters, listId, dryRun: false },
                  })
                    .then((response) => {
                      if (!response.ok) {
                        setMessage(response.message)
                        return
                      }
                      if (response.dryRun) return
                      const process = response.processIds.length ? ` processId: ${response.processIds.join(', ')}` : ''
                      const errs = response.errors.length ? ` Грешки: ${response.errors.join(' · ')}` : ''
                      const warnings =
                        response.roleWarnings > 0 ? ` Предупреждения ROLE: ${response.roleWarnings}.` : ''
                      const rejected = response.rejected.length
                        ? ` Отхвърлени от Brevo: ${response.rejected.join(' · ')}`
                        : response.pending.length
                          ? ` Brevo още обработва: ${response.pending.join(', ')}.`
                          : ' Brevo завърши без отхвърлени редове.'
                      const text = `${response.message}${process}${warnings}${errs}${rejected}`
                      setResult(text)
                      setMessage(text)
                      setPreview(null)
                    })
                    .finally(() => setBusy(false))
                }}
              >
                Синхронизирай {brevoContactCount(preview.total)} към „{preview.listName}“
              </button>
            ) : null}
          </div>
          {preview ? (
            <p className="text-sm font-bold text-[#1a1020]" role="status">
              {brevoSyncPreviewText(preview.total, preview.listName)}
            </p>
          ) : null}
          {preview ? (
            <p className="text-sm text-[#333]">
              Примери: {preview.samples.join(', ') || '—'}. Без валидна секция: {preview.lackingSection}. Без SMS:{' '}
              {preview.lackingSms}.
            </p>
          ) : null}
          {result ? <p className="text-sm text-[#1a1020]">{result}</p> : null}
        </>
      )}
    </section>
  )
}

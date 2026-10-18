import { useEffect, useState } from 'react'
import { adminBrevoPrepareCampaign, adminBrevoStatus } from '../../signup/admin-brevo'
import { BrevoHealthSummary } from './-brevo-health'
import { BrevoListSelect } from './-brevo-list-select'

const ghost =
  'inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[#2b062f] bg-white px-4 text-sm font-bold text-[#2b062f]'

type CampaignResult = { ok: boolean; message: string; campaignId: number | null; campaignUrl: string | null }

export function BrevoCampaignPanel(props: {
  enabled: boolean
  view: string
  mir: string
  q?: string
  setMessage: (message: string) => void
}) {
  const { enabled, view, mir, q = '', setMessage } = props
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [hint, setHint] = useState('')
  const [subject, setSubject] = useState('Кампания Ти Броиш')
  const [busy, setBusy] = useState(false)
  const [listId, setListId] = useState('')
  const [listName, setListName] = useState('')
  const [result, setResult] = useState<CampaignResult | null>(null)

  const run = (sendNow: boolean) => {
    setBusy(true)
    setResult(null)
    void adminBrevoPrepareCampaign({ data: { view, mir, q, subject, sendNow, listId } })
      .then((response) => {
        const url = 'campaignUrl' in response ? (response.campaignUrl ?? null) : null
        const id = 'campaignId' in response ? (response.campaignId ?? null) : null
        setResult({ ok: response.ok, message: response.message, campaignId: id, campaignUrl: url })
        setMessage(response.message)
      })
      .catch(() => setResult({ ok: false, message: 'Brevo заявката не мина. Опитай пак.', campaignId: null, campaignUrl: null }))
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    if (!enabled) return
    void adminBrevoStatus().then((result) => {
      if (!result.ok) return
      setConfigured(result.configured)
      if (!result.configured) setHint(result.hint)
      else {
        if (result.listId && !listId) setListId(String(result.listId))
        setHint(`Шаблон ${result.templateId ?? 'html'} · ${result.senderEmail}`)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  if (!enabled) return null

  return (
    <section className="grid gap-3 border-t-2 border-[#2b062f] pt-4">
      <h2 className="text-xl font-black text-[#1a1020]">Brevo кампания</h2>
      {configured === false ? (
        <p className="text-sm text-[#a33]">
          Липсва <code>BREVO_API_KEY</code>. Задай го с{' '}
          <code>wrangler secret put BREVO_API_KEY</code> (staging и production). Дотогава ползвай CSV за Brevo.
          {hint ? ` ${hint}` : ''}
        </p>
      ) : (
        <>
          <p className="text-sm text-[#333]">{hint || 'Проверявам настройката…'}</p>
          {configured === true ? <BrevoHealthSummary /> : null}
          <label className="grid gap-1 text-sm font-semibold">
            Тема
            <input
              className="min-h-11 w-full max-w-xl rounded-xl border-2 border-[#4a314f] bg-white px-3 text-[#1a1020]"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          {configured === true ? (
            <BrevoListSelect
              value={listId}
              disabled={busy}
              onChange={(next, name) => {
                setListId(next)
                setListName(name)
              }}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={ghost}
              disabled={busy || configured !== true}
              onClick={() => run(false)}
            >
              {busy ? 'Подготвям…' : 'Подготви кампания в Brevo'}
            </button>
            <button
              type="button"
              className={ghost}
              disabled={busy || configured !== true}
              onClick={() => {
                if (
                  !window.confirm(
                    listName
                      ? `Това ще създаде кампания и ще я ИЗПРАТИ веднага към списък „${listName}“ в Brevo. Продължаваме?`
                      : 'Това ще създаде кампания и ще я ИЗПРАТИ веднага към избрания списък в Brevo. Продължаваме?',
                  )
                ) {
                  return
                }
                run(true)
              }}
            >
              Подготви и изпрати сега
            </button>
          </div>
          {result ? (
            <p
              className={`text-sm font-bold ${result.ok ? 'text-[#145744]' : 'text-[#8f1d1d]'}`}
              role={result.ok ? 'status' : 'alert'}
            >
              {result.message}
              {result.campaignUrl ? (
                <>
                  {' '}
                  <a className="underline" href={result.campaignUrl} target="_blank" rel="noreferrer">
                    Отвори кампания {result.campaignId} в Brevo
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          <p className="text-sm text-[#333]">
            Синхронизира контактите от текущия изглед към избрания списък (по подразбиране е избран основният списък), създава кампания като чернова (template или HTML)
            и праща само ако избереш „изпрати сега“. CSV експортът остава.
          </p>
        </>
      )}
    </section>
  )
}

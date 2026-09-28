import { useEffect, useState } from 'react'
import { adminBrevoPrepareCampaign, adminBrevoStatus } from '../../signup/admin-brevo'

const ghost = 'inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[#2b062f] bg-white px-4 text-sm font-bold text-[#2b062f]'

export function BrevoCampaignPanel(props: {
  enabled: boolean
  view: string
  mir: string
  setMessage: (message: string) => void
}) {
  const { enabled, view, mir, setMessage } = props
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [hint, setHint] = useState('')
  const [subject, setSubject] = useState('Кампания Ти Броиш')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!enabled) return
    void adminBrevoStatus().then((result) => {
      if (!result.ok) return
      setConfigured(result.configured)
      if (!result.configured) setHint(result.hint)
      else setHint(`Списък ${result.listId ?? '—'} · шаблон ${result.templateId ?? 'html'} · ${result.senderEmail}`)
    })
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
          <label className="grid gap-1 text-sm font-semibold">
            Тема
            <input className="min-h-11 w-full max-w-xl rounded-xl border-2 border-[#4a314f] bg-white px-3 text-[#1a1020]" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={ghost}
              disabled={busy || configured !== true}
              onClick={() => {
                setBusy(true)
                void adminBrevoPrepareCampaign({ data: { view, mir, subject, sendNow: false } }).then((result) => {
                  setBusy(false)
                  setMessage(result.message)
                })
              }}
            >
              Подготви кампания в Brevo
            </button>
            <button
              type="button"
              className={ghost}
              disabled={busy || configured !== true}
              onClick={() => {
                setBusy(true)
                void adminBrevoPrepareCampaign({ data: { view, mir, subject, sendNow: true } }).then((result) => {
                  setBusy(false)
                  setMessage(result.message)
                })
              }}
            >
              Подготви и изпрати сега
            </button>
          </div>
          <p className="text-sm text-[#333]">Синхронизира контактите от текущия изглед към BREVO_LIST_ID, създава кампания (template или HTML) и по желание вика sendNow. CSV експортът остава.</p>
        </>
      )}
    </section>
  )
}

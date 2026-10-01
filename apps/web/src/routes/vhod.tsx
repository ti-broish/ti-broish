import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { checkEmailCode, requestSignInCode } from '../signup/confirm-mail'
import { invalidateSessionLoad } from '../signup/use-registration'
import { validEmail } from '../signup/model'
import { useProfile } from '../signup/store'

export const Route = createFileRoute('/vhod')({ component: LoginPage })

function LoginPage() {
  const navigate = useNavigate()
  const { profile, ready } = useProfile()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState('')
  const [phase, setPhase] = useState<'email' | 'code' | 'missing' | 'failed'>('email')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const here = ready && profile.emailConfirmed && profile.email.includes('@')

  return (
    <div className="grid gap-4">
      <PageIntro title="Влез в профила си" lede="Въведи имейла от записването. Ако вече си го потвърдил, пращаме шестцифрен код." />
      {here ? (
        <p className="leading-7">
          На това устройство вече си влязъл като {profile.email}. <Link to="/profil">Отвори профила</Link>.
        </p>
      ) : null}
      {phase === 'missing' ? (
        <p className="leading-7">
          Няма потвърдено записване с този имейл. <Link to="/signup" search={{ step: 'contact' }}>Запиши се</Link>.
        </p>
      ) : null}
      {phase === 'failed' ? <p className="leading-7">Писмото не тръгна. Опитай отново след малко.</p> : null}
      {phase === 'code' ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            setBusy(true)
            void checkEmailCode({ data: { email, code } }).then(async (result) => {
              setBusy(false)
              if (!result.ok) {
                setError('Кодът не съвпада.')
                return
              }
              invalidateSessionLoad()
              await navigate({ to: '/profil' })
            })
          }}
        >
          <p className="leading-7">
            {preview ? `Оттук писмото не тръгва. Кодът е ${preview}.` : `Изпратихме код на ${email}.`}
          </p>
          <label className="grid gap-1 text-sm font-semibold">
            Код от писмото
            <input className="min-h-11 rounded-xl border border-[var(--line)] px-3" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button type="submit" className="brand-button" disabled={busy}>
            Влез
          </button>
        </form>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            const entered = String(new FormData(event.currentTarget).get('email') ?? email)
            setEmail(entered)
            setError('')
            if (!validEmail(entered)) {
              setError('Нужен е валиден имейл.')
              return
            }
            setBusy(true)
            void requestSignInCode({ data: { email: entered } })
              .then((result) => {
                setBusy(false)
                if (result.status === 'missing') {
                  setPhase('missing')
                  return
                }
                if (result.status === 'failed' || result.status === 'unavailable') {
                  setPhase('failed')
                  return
                }
                if (result.status === 'invalid') {
                  setError('Нужен е валиден имейл.')
                  return
                }
                setPreview(result.previewCode)
                setPhase('code')
              })
              .catch(() => {
                setBusy(false)
                setError('Писмото не тръгна. Опитай отново.')
              })
          }}
        >
          <label className="grid gap-1.5 text-sm font-semibold">
            Имейл
            <input name="email" className="min-h-11 rounded-xl border border-[var(--line)] px-3" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button type="submit" className="brand-button" disabled={busy}>
            Изпрати код
          </button>
        </form>
      )}
    </div>
  )
}

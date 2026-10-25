import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { PhotoField } from '../components/PhotoField'
import { loadSignup } from '../signup/db'
import { bgDateTime } from '../signup/election'
import { PROTOCOL_PHOTO } from '../signup/photos'
import { checkProtocol, PROTOCOL_PHOTOS_MAX, PROTOCOL_PHOTOS_MIN, sendProtocol } from '../signup/protocol-api'
import { useProtocolWindow } from '../signup/protocol-window'
import { recaptchaToken } from '../signup/recaptcha'
import { rememberReport } from '../signup/report-memory'
import type { PhotoInput } from '../signup/reports-validate'
import { useProfile } from '../signup/store'

export const Route = createFileRoute('/protokol')({ component: ProtocolPage })

const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3'
const button = 'brand-button disabled:opacity-40'

function ProtocolPage() {
  const { profile, ready } = useProfile()
  const protocolWindow = useProtocolWindow()
  const seeded = useRef(false)
  const [email, setEmail] = useState('')
  const [photos, setPhotos] = useState<PhotoInput[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ id: string; secret: string; contactSaved: boolean | null } | null>(null)

  useEffect(() => {
    if (!ready || seeded.current) return
    let cancelled = false
    void loadSignup()
      .catch(() => null)
      .then((remote) => {
        if (cancelled || seeded.current) return
        seeded.current = true
        setEmail(remote?.profile.email || profile.email)
      })
    return () => {
      cancelled = true
    }
  }, [ready, profile.email])

  if (sent) {
    return (
      <div className="grid gap-4">
        <PageIntro title="Протоколът е изпратен" lede="Получихме снимките. Екипът на Ти броиш ги проверява." />
        <p className="rounded-2xl bg-[#eee] px-4 py-3 leading-7">
          Номер на протокола: <span className="font-mono font-bold">{sent.id}</span>
        </p>
        {sent.contactSaved === false ? (
          <p className="text-red-700">Протоколът е изпратен, но имейлът не се записа. Ако снимките не се четат, няма как да ти пишем.</p>
        ) : null}
        <Link to="/izprateni/$id" params={{ id: sent.id }} search={{ secret: sent.secret }} className="brand-button">
          Виж протокола
        </Link>
        <button type="button" className="brand-button" onClick={() => setSent(null)}>
          Изпрати друг протокол
        </button>
        <Link to="/signal" className="brand-button">
          Подай сигнал
        </Link>
      </div>
    )
  }

  // A form already being filled stays usable if the window closes meanwhile; the API has no cut-off.
  if (!protocolWindow.open && photos.length === 0 && !busy) {
    const next = protocolWindow.window
    const opensLater = next && protocolWindow.now < next.opens
    return (
      <div className="grid gap-4">
        <PageIntro
          title={opensLater ? `Протоколът се праща от ${bgDateTime(next.opens)}` : 'Изпращането на протоколи приключи'}
          lede={
            opensLater
              ? `Изпращането се отваря, когато секциите затворят, и е отворено до ${bgDateTime(next.closes)}. Дотогава можеш да подадеш сигнал за нарушение.`
              : 'Благодарим на всички, които изпратиха протокол. Сигнал за нарушение можеш да подадеш и сега.'
          }
        />
        <Link to="/signal" className="brand-button">
          Подай сигнал
        </Link>
      </div>
    )
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy) return
        const invalid = checkProtocol(email, photos)
        if (invalid) {
          setError(invalid)
          return
        }
        setBusy(true)
        setError('')
        void sendProtocol(email, photos, { recaptcha: recaptchaToken })
          .then((result) => {
            if (!result.ok) {
              setError(result.message)
              return
            }
            rememberReport({
              id: result.id,
              secret: result.secret,
              kind: 'protocol',
              source: 'api',
              createdAt: new Date().toISOString(),
              title: 'Протокол',
              photoCount: result.pictureCount,
            })
            setSent({ id: result.id, secret: result.secret, contactSaved: result.contactSaved })
            setPhotos([])
          })
          .catch(() => setError('Протоколът не беше изпратен. Опитай пак след малко.'))
          .finally(() => setBusy(false))
      }}
    >
      <PageIntro
        title="Изпрати протокол"
        lede={`Снимай целия протокол, от началото до печата и подписите, по една страница на снимка. Нужни са поне ${PROTOCOL_PHOTOS_MIN} снимки. Работи и без профил.`}
      />
      {protocolWindow.test ? <p className="rounded-2xl bg-[#fde68a] px-4 py-3 font-bold">ТЕСТ: прозорецът е отворен ръчно (само извън tibroish.bg).</p> : null}
      <PhotoField photos={photos} onChange={setPhotos} minimum={PROTOCOL_PHOTOS_MIN} maximum={PROTOCOL_PHOTOS_MAX} limits={PROTOCOL_PHOTO} />
      <label className="grid gap-1 text-sm font-semibold">
        Имейл, ако искаш да ти пишем при проблем със снимките
        <input className={field} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      {error ? <p className="text-red-700">{error}</p> : null}
      <button className={button} type="submit" disabled={busy || photos.length < PROTOCOL_PHOTOS_MIN}>
        {busy ? 'Изпращаме…' : 'Изпрати протокол'}
      </button>
    </form>
  )
}

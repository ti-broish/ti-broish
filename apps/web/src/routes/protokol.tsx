import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { PhotoField } from '../components/PhotoField'
import { loadSignup } from '../signup/db'
import { isProtocolDay } from '../signup/election'
import { rememberReport } from '../signup/report-memory'
import { submitProtocol } from '../signup/reports'
import type { PhotoInput } from '../signup/reports-validate'
import { useProfile } from '../signup/store'

export const Route = createFileRoute('/protokol')({ component: ProtocolPage })

const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3'
const button = 'brand-button disabled:opacity-40'

function ProtocolPage() {
  const { profile, ready } = useProfile()
  const seeded = useRef(false)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<PhotoInput[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ id: string; secret: string } | null>(null)

  useEffect(() => {
    if (!ready || seeded.current) return
    let cancelled = false
    void loadSignup().then((remote) => {
      if (cancelled || seeded.current) return
      seeded.current = true
      setEmail(remote?.profile.email || profile.email)
    })
    return () => {
      cancelled = true
    }
  }, [ready, profile.email])

  if (!isProtocolDay()) {
    return (
      <div className="grid gap-4">
        <PageIntro
          title="Протоколът се праща в изборния ден"
          lede="Изпращането е отворено на 25 октомври и на 1 ноември. Дотогава сигналът за нарушение си остава."
        />
        <Link to="/signal" className="brand-button">
          Подай сигнал
        </Link>
      </div>
    )
  }

  if (sent) {
    return (
      <div className="grid gap-4">
        <PageIntro title="Протоколът е изпратен" lede="Ако снимките не се четат, ще пишем на имейла, който си оставил." />
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

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (photos.length < 4) {
          setError('Качи поне 4 снимки, за да се вижда целият протокол.')
          return
        }
        setBusy(true)
        setError('')
        void submitProtocol({ data: { email, note, photos } }).then((result) => {
          setBusy(false)
          if (!result.ok) {
            setError(result.message)
            return
          }
          rememberReport({ id: result.id, secret: result.secret, kind: 'protocol' })
          setSent({ id: result.id, secret: result.secret })
          setPhotos([])
          setNote('')
        })
      }}
    >
      <PageIntro
        title="Изпрати протокол"
        lede="Снимай целия протокол, от началото до печата и подписите. Нужни са поне 4 снимки. Работи и без профил."
      />
      <PhotoField photos={photos} onChange={setPhotos} minimum={4} />
      <label className="grid gap-1 text-sm font-semibold">
        Имейл, ако искаш вест при проблем със снимките
        <input className={field} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Бележка към снимките
        <textarea className={`${field} min-h-24`} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error ? <p className="text-red-700">{error}</p> : null}
      <button className={button} type="submit" disabled={busy || photos.length < 4}>
        {busy ? 'Изпращаме…' : 'Изпрати протокол'}
      </button>
    </form>
  )
}

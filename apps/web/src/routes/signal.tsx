import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { PhotoField } from '../components/PhotoField'
import { PlacesPicker } from '../components/PlacesPicker'
import { loadSignup } from '../signup/db'
import { isProtocolDay } from '../signup/election'
import { placeLabel, placeReady, validEmail, validPhone, type HomePlace } from '../signup/model'
import { rememberReport } from '../signup/report-memory'
import { submitViolation } from '../signup/reports'
import type { PhotoInput } from '../signup/reports-validate'
import { useProfile } from '../signup/store'

export const Route = createFileRoute('/signal')({ component: SignalPage })

const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3'
const button = 'brand-button disabled:opacity-40'

function SignalPage() {
  const { profile, ready } = useProfile()
  const seeded = useRef(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [description, setDescription] = useState('')
  const [place, setPlace] = useState<HomePlace | null>(null)
  const [wantCall, setWantCall] = useState(false)
  const [photos, setPhotos] = useState<PhotoInput[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ id: string; secret: string } | null>(null)
  const [prefilled, setPrefilled] = useState(false)

  useEffect(() => {
    if (!ready || seeded.current) return
    let cancelled = false
    void loadSignup().then((remote) => {
      if (cancelled || seeded.current) return
      seeded.current = true
      const source = remote?.profile ?? profile
      const fullName = [source.firstName, source.middleName, source.lastName].filter(Boolean).join(' ')
      setName(fullName)
      setEmail(source.email)
      setPhone(source.phone)
      setPlace(source.place)
      setPrefilled(Boolean(fullName || source.email || source.phone))
    })
    return () => {
      cancelled = true
    }
  }, [ready, profile])

  if (sent) {
    return (
      <div className="grid gap-4">
        <PageIntro title="Сигналът е изпратен" lede="Екипът го преглежда. Запази тази страница, ако искаш да го отвориш пак." />
        <Link to="/izprateni/$id" params={{ id: sent.id }} search={{ secret: sent.secret }} className="brand-button">
          Виж сигнала
        </Link>
        <button type="button" className="brand-button" onClick={() => setSent(null)}>
          Изпрати друг сигнал
        </button>
        {isProtocolDay() ? (
          <Link to="/protokol" className="brand-button">
            Изпрати протокол
          </Link>
        ) : null}
      </div>
    )
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim().length < 2 || !validEmail(email) || !validPhone(phone) || description.trim().length < 20 || !placeReady(place)) {
          setError('Нужни са населено място, име, имейл, телефон и описание от поне 20 знака.')
          return
        }
        setBusy(true)
        setError('')
        void submitViolation({
          data: { name, email, phone, description, place, wantCall, photos },
        }).then((result) => {
          setBusy(false)
          if (!result.ok) {
            setError(result.message)
            return
          }
          rememberReport({ id: result.id, secret: result.secret, kind: 'violation' })
          setSent({ id: result.id, secret: result.secret })
          setDescription('')
          setPhotos([])
        })
      }}
    >
      <PageIntro
        title="Подай сигнал"
        lede="Първо кажи на председателя на СИК. Ако нарушението остане, опиши къде, кога и какво се случва. Работи и без профил."
      />
      {prefilled ? <p className="text-sm leading-6">Попълнено от профила ти. Можеш да го промениш.</p> : null}
      <PlacesPicker
        value={place}
        onChange={setPlace}
        sectionLabel="Секция"
        footnote="Списъкът със секции е от последните избори. Секцията може да остане празна, ако сигналът е за населеното място."
      />
      <label className="grid gap-1 text-sm font-semibold">
        Име
        <input className={field} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Имейл
        <input className={field} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Телефон
        <input className={field} type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Описание на нарушението
        <textarea
          className={`${field} min-h-32`}
          minLength={20}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
        />
      </label>
      <label className="flex items-start gap-3 leading-7">
        <input type="checkbox" className="mt-1" checked={wantCall} onChange={(event) => setWantCall(event.target.checked)} />
        <span>Искам да ми се обадите по този сигнал.</span>
      </label>
      <PhotoField photos={photos} onChange={setPhotos} />
      {place ? <p className="text-sm leading-6">{placeLabel(place)}</p> : null}
      {error ? <p className="text-red-700">{error}</p> : null}
      <button className={button} type="submit" disabled={busy}>
        {busy ? 'Изпращаме…' : 'Изпрати'}
      </button>
    </form>
  )
}

import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { SignalPartnerBanner, partnerClass } from '../components/SignalPartner'
import { PhotoField } from '../components/PhotoField'
import { PlacesPicker } from '../components/PlacesPicker'
import { loadSignup } from '../signup/db'
import { isProtocolDay } from '../signup/election'
import { placeLabel, placeReady, validEmail, validPhone, type HomePlace } from '../signup/model'
import { recaptchaToken } from '../signup/recaptcha'
import { rememberReport } from '../signup/report-memory'
import { VIOLATION_DESCRIPTION_MAX, validateViolation, type PhotoInput } from '../signup/reports-validate'
import { sendViolation } from '../signup/violation-api'
import { mergePlace, oblastPlace, parseSignalSearch } from '../signup/signal-prefill'
import { recordSignalOrigin } from '../signup/signal-origin'
import { useProfile } from '../signup/store'

// ?name=, ?email= and ?oblast= pre-fill the form (partners link people here). See signup/signal-prefill.ts.
// ?origin=iaz co-brands the page and is stored with the sent signal (signup/signal-origin.ts).
export const Route = createFileRoute('/signal')({
  validateSearch: parseSignalSearch,
  component: SignalPage,
})

const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3'
const button = 'brand-button disabled:opacity-40'

function SignalPage() {
  const { profile, ready } = useProfile()
  const seeded = useRef(false)
  const search = Route.useSearch()
  const navigate = useNavigate()
  // Read once: the parameters are dropped from the address bar below, the values stay in the form.
  const link = useRef({ name: search.name ?? '', email: search.email ?? '', place: oblastPlace(search.oblast), origin: search.origin })
  const origin = link.current.origin
  const theme = partnerClass(origin)
  const [name, setName] = useState(link.current.name)
  const [email, setEmail] = useState(link.current.email)
  const [phone, setPhone] = useState('')
  const [description, setDescription] = useState('')
  const [place, setPlace] = useState<HomePlace | null>(link.current.place)
  const [photos, setPhotos] = useState<PhotoInput[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ id: string; secret: string } | null>(null)
  const [prefilled, setPrefilled] = useState<'profile' | 'link' | null>(
    link.current.name || link.current.email || link.current.place ? 'link' : null,
  )

  // Keep a pre-filled name and email out of the address bar, history and later shares of the URL.
  // ?origin= is not personal and stays, so a reload keeps the partner's branding.
  useEffect(() => {
    if (search.name === undefined && search.email === undefined && search.oblast === undefined) return
    void navigate({ to: '/signal', search: origin ? { origin } : {}, replace: true })
  }, [navigate, search.name, search.email, search.oblast, origin])

  useEffect(() => {
    if (!ready || seeded.current) return
    let cancelled = false
    void loadSignup().then((remote) => {
      if (cancelled || seeded.current) return
      seeded.current = true
      const source = remote?.profile ?? profile
      const fullName = [source.firstName, source.middleName, source.lastName].filter(Boolean).join(' ')
      const fromLink = link.current
      setName(fromLink.name || fullName)
      setEmail(fromLink.email || source.email)
      setPhone(source.phone)
      setPlace(mergePlace(fromLink.place, source.place))
      if (fullName || source.email || source.phone) setPrefilled('profile')
    })
    return () => {
      cancelled = true
    }
  }, [ready, profile])

  if (sent) {
    return (
      <div className={`grid gap-4 ${theme}`}>
        <SignalPartnerBanner origin={origin} />
        <PageIntro title="Сигналът е изпратен" lede="Получихме го. Екипът на Ти броиш го преглежда." />
        <p className="rounded-2xl bg-[#eee] px-4 py-3 leading-7">
          Номер на сигнала: <span className="font-mono font-bold">{sent.id}</span>
        </p>
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
      className={`grid gap-4 ${theme}`}
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim().length < 2 || !validEmail(email) || !validPhone(phone) || description.trim().length < 20 || !placeReady(place)) {
          setError('Нужни са населено място, име, имейл, телефон и описание от поне 20 знака.')
          return
        }
        const parsed = validateViolation({ name, email, phone, description, place, photos })
        if (typeof parsed === 'string') {
          setError(parsed)
          return
        }
        setBusy(true)
        setError('')
        void sendViolation(parsed.payload, parsed.photos, { recaptcha: recaptchaToken }).then((result) => {
          setBusy(false)
          if (!result.ok) {
            setError(result.message.startsWith('Сигналът') ? result.message : `Сигналът не беше изпратен. ${result.message}`)
            return
          }
          rememberReport({
            id: result.id,
            secret: result.secret,
            kind: 'violation',
            source: 'api',
            createdAt: new Date().toISOString(),
            title: parsed.payload.description.slice(0, 140),
            photoCount: result.pictures.length,
          })
          if (origin) void recordSignalOrigin({ data: { violationId: result.id, origin } }).catch(() => undefined)
          setSent({ id: result.id, secret: result.secret })
          setDescription('')
          setPhotos([])
        }).catch(() => {
          setBusy(false)
          setError('Сигналът не беше изпратен. Опитай пак след малко.')
        })
      }}
    >
      <SignalPartnerBanner origin={origin} />
      <PageIntro
        title="Подай сигнал"
        lede="Първо кажи на председателя на СИК. Ако нарушението остане, опиши къде, кога и какво се случва. Работи и без профил."
      />
      {prefilled ? (
        <p className="text-sm leading-6">
          {prefilled === 'profile' ? 'Попълнено от профила ти. Можеш да го промениш.' : 'Попълнихме част от полетата. Можеш да ги промениш.'}
        </p>
      ) : null}
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
          maxLength={VIOLATION_DESCRIPTION_MAX}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
        />
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

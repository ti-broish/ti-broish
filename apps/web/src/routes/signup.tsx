import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { BulgariaMap, type MapPoint } from '../components/BulgariaMap'
import { PartnerBanner } from '../components/PartnerBanner'
import { PlacesPicker } from '../components/PlacesPicker'
import { StaffNote } from '../components/StaffNote'
import { TravelChoice } from '../components/TravelChoice'
import { checkEmailCode, requestEmailCode } from '../signup/confirm-mail'
import { loadSignup, saveSignup } from '../signup/db'
import { geocodePlace } from '../signup/geo'
import {
  EXPERIENCE,
  assignmentLocked,
  highlightCodes,
  placeLabel,
  placeOutline,
  placeReady,
  radiusOptions,
  registrationSettled,
  signupGap,
  roleLabel,
  stepsFor,
  travelOutline,
  validEmail,
  validName,
  validPhone,
  type Companion,
  type Experience,
  type Profile,
  type Role,
  type StepId,
} from '../signup/model'
import { campaignFromSearch, locationEditable, mirOf, needsWiderTravel, placeChangeAllowed, validEgn } from '../signup/rules'
import { placeSummaries } from '../signup/sections'
import { useOutlines } from '../signup/use-outlines'
import { updateProfile, useProfile } from '../signup/store'
import type { CityRegion, PollingSection } from '../signup/geo'

export const Route = createFileRoute('/signup')({
  validateSearch: (search: Record<string, unknown>): { step: string } => ({
    step: typeof search.step === 'string' ? search.step : 'contact',
  }),
  component: SignupPage,
})

const button = 'brand-button disabled:opacity-40'
const ghost = 'flex min-h-14 w-full items-center justify-center rounded-[20px] border border-[#ddd] bg-white px-5 text-xl font-bold text-[#333]'
const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3'

function SignupPage() {
  const { step } = Route.useSearch()
  const navigate = useNavigate()
  const { profile, ready } = useProfile()
  const [error, setError] = useState('')
  const [mailFailed, setMailFailed] = useState(false)
  useEffect(() => {
    const found = campaignFromSearch(new URLSearchParams(window.location.search))
    if (!found.source && !found.referredBy) return
    updateProfile((current) => ({
      ...current,
      source: current.source || found.source,
      referredBy: current.referredBy || found.referredBy,
    }))
  }, [])
  useEffect(() => {
    let cancelled = false
    void loadSignup().then((remote) => {
      if (cancelled || !remote) return
      const found = campaignFromSearch(new URLSearchParams(window.location.search))
      updateProfile({
        ...remote.profile,
        source: remote.profile.source || found.source,
        referredBy: remote.profile.referredBy || found.referredBy,
        referrerName: remote.referrerName,
      })
    })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    if (!ready || !profile.email.includes('@')) return
    const handle = window.setTimeout(() => {
      const counted = signupGap(profile) === null && !profile.withdrawn
      const payload = counted ? { ...profile, submitted: true } : profile
      if (counted && !profile.submitted) updateProfile({ submitted: true })
      void saveSignup({ data: payload }).then((result) => {
        if (!result.ok) return
        if (result.pendingLinks.length > 0) setUnsentCompanionLinks(result.pendingLinks)
        if (result.referrerName && result.referrerName !== profile.referrerName) {
          updateProfile({ referrerName: result.referrerName })
        }
      })
    }, 600)
    return () => window.clearTimeout(handle)
  }, [profile, ready])
  const [companion, setCompanion] = useState<Companion>(blankCompanion())
  const [unsentCompanionLinks, setUnsentCompanionLinks] = useState<{ email: string; link: string }[]>([])
  const steps = stepsFor(profile)
  const requested = step === 'radius' ? 'travel' : step
  const current = (steps as readonly string[]).includes(requested) ? (requested as StepId) : 'contact'
  const index = Math.max(0, steps.indexOf(current as (typeof steps)[number]))
  const settled = useReviewCopy(current, profile, ready)

  function go(next: StepId) {
    setError('')
    void navigate({ to: '/signup', search: { step: next } })
  }

  function nextStep() {
    const following = steps[index + 1]
    if (following) go(following)
  }

  const titles: Record<StepId, string> = {
    contact: 'Как да се свържем с теб',
    confirm: 'Потвърди имейла си',
    egn: 'ЕГН за разпределението',
    role: 'Как ще пазиш вота',
    rounds: 'Кога можеш да участваш',
    experience: 'Колко си подготвен',
    place: 'Къде е твоето място',
    travel: 'Докъде можеш да стигнеш',
    seats: profile.role === 'mobile' ? 'Кола и дрон' : 'Свободни места в колата',
    people: 'Хора с теб',
    review: settled ? 'Преглед на данните' : 'Преглед, преди да се запишеш',
  }

  if (!ready) return <p>Зареждаме данните…</p>

  return (
    <div className="grid gap-4">
      <h1 className="text-3xl font-black text-[#444]">{titles[current]}</h1>
      <PartnerBanner source={profile.source} />
      {current === 'review' && settled ? <p className="text-lg leading-7">Провери промените и ги запази.</p> : null}
      {current === 'contact' ? (
        <p className="text-lg leading-7">
          {settled
            ? 'Президентските избори 2026 г. са на 25 октомври и 1 ноември. Тук променяш как да се свържем с теб.'
            : 'Записването е за президентските избори 2026 г. на 25 октомври и 1 ноември. Можеш да добавиш и други хора и да отидете заедно като група.'}
        </p>
      ) : null}
      {profile.referredBy ? <p>Покана от {profile.referrerName || 'човек, който вече се е записал'}.</p> : null}
      {current === 'contact' ? <Contact error={error} onError={setError} onMailFailed={setMailFailed} onNext={() => go(profile.emailConfirmed ? (profile.egn ? 'role' : 'egn') : 'confirm')} /> : null}
      {current === 'confirm' ? <Confirm error={error} onError={setError} mailFailed={mailFailed} onMailFailed={setMailFailed} onNext={() => go('egn')} /> : null}
      {current === 'egn' ? <EgnStep error={error} onError={setError} onNext={nextStep} /> : null}
      {current === 'role' ? <RoleStep error={error} onError={setError} onNext={nextStep} /> : null}
      {current === 'rounds' ? <Rounds error={error} onError={setError} onNext={nextStep} /> : null}
      {current === 'experience' ? <ExperienceStep error={error} onError={setError} onNext={nextStep} /> : null}
      {current === 'place' ? <PlaceStep error={error} onError={setError} onNext={nextStep} /> : null}
      {current === 'travel' ? <TravelStep error={error} onError={setError} onNext={nextStep} /> : null}
      {current === 'seats' ? <Seats error={error} onError={setError} onNext={nextStep} /> : null}
      {current === 'people' ? <People companion={companion} setCompanion={setCompanion} error={error} onError={setError} onNext={nextStep} unsentLinks={unsentCompanionLinks} /> : null}
      {current === 'review' ? <Review settled={settled} error={error} onError={setError} /> : null}
      {index > 0 ? (
        <button type="button" className={`${ghost} mt-6`} onClick={() => go(steps[index - 1] ?? 'contact')}>
          Назад
        </button>
      ) : null}
    </div>
  )
}

function Contact({ error, onError, onMailFailed, onNext }: { error: string; onError: (value: string) => void; onMailFailed: (failed: boolean) => void; onNext: () => void }) {
  const { profile } = useProfile()
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!validName(profile.firstName) || !validName(profile.middleName) || !validName(profile.lastName)) {
          onError('Трите имена са на кирилица.')
          return
        }
        if (!validEmail(profile.email) || !validPhone(profile.phone)) {
          onError('Нужни са валидни имейл и телефон.')
          return
        }
        void requestEmailCode({
          data: {
            email: profile.email,
            firstName: profile.firstName,
            middleName: profile.middleName,
            lastName: profile.lastName,
            phone: profile.phone,
          },
        })
          .then((result) => {
            updateProfile({ confirmCode: result.previewCode })
            onMailFailed(!result.sent && !result.previewCode)
          })
          .catch(() => {
            updateProfile({ confirmCode: '' })
            onMailFailed(true)
          })
          .finally(onNext)
      }}
    >
      <LegalNotice />
      <NameFields />
      <label className="grid gap-1 text-sm font-semibold">
        Имейл
        <input className={field} inputMode="email" autoComplete="email" value={profile.email} onChange={(event) => updateProfile({ email: event.target.value, emailConfirmed: false })} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Телефон
        <input className={field} inputMode="tel" autoComplete="tel" placeholder="08xxxxxxxx" value={profile.phone} onChange={(event) => updateProfile({ phone: event.target.value })} />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button className={button} type="submit">
        Изпрати код за потвърждение
      </button>
    </form>
  )
}

function NameFields() {
  const { profile } = useProfile()
  const fields = [
    ['firstName', 'Име', 'given-name'],
    ['middleName', 'Презиме', 'additional-name'],
    ['lastName', 'Фамилия', 'family-name'],
  ] as const
  return (
    <>
      {fields.map(([key, label, autoComplete]) => (
        <label key={key} className="grid gap-1 text-sm font-semibold">
          {label}
          <input className={field} autoComplete={autoComplete} value={profile[key]} onChange={(event) => updateProfile({ [key]: event.target.value })} />
        </label>
      ))}
    </>
  )
}

function Confirm({
  error,
  onError,
  onNext,
  mailFailed,
  onMailFailed,
}: {
  error: string
  onError: (value: string) => void
  onNext: () => void
  mailFailed: boolean
  onMailFailed: (failed: boolean) => void
}) {
  const { profile } = useProfile()
  const [code, setCode] = useState('')
  const [retrying, setRetrying] = useState(false)
  const preview = profile.confirmCode

  function resend() {
    setRetrying(true)
    onError('')
    void requestEmailCode({
      data: {
        email: profile.email,
        firstName: profile.firstName,
        middleName: profile.middleName,
        lastName: profile.lastName,
        phone: profile.phone,
      },
    })
      .then((result) => {
        updateProfile({ confirmCode: result.previewCode })
        onMailFailed(!result.sent && !result.previewCode)
      })
      .catch(() => onMailFailed(true))
      .finally(() => setRetrying(false))
  }

  return (
    <div className="grid gap-4">
      <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
        <p className="text-sm text-[var(--ink-soft)]">От: Ти Броиш · До: {profile.email}</p>
        <h2 className="mt-2 text-xl font-extrabold">Потвърди имейла, преди да продължиш</h2>
        {preview ? (
          <p className="mt-2 leading-7">Кодът за този прототип е {preview}. Щом писмото тръгне, кодът остава само в него.</p>
        ) : mailFailed ? (
          <p className="mt-2 leading-7">Писмото не тръгна до {profile.email}. Кодът не важи, докато не го изпратим отново.</p>
        ) : (
          <p className="mt-2 leading-7">Изпратихме шестцифрен код на {profile.email}. Отвори писмото и го въведи тук.</p>
        )}
        {preview ? null : (
          <button type="button" className={`${ghost} mt-3`} disabled={retrying} onClick={resend}>
            {retrying ? 'Изпращаме…' : 'Изпрати кода отново'}
          </button>
        )}
        <LegalNotice />
        {preview ? (
          <button
            type="button"
            className={`${button} mt-3`}
            onClick={() => {
              updateProfile({ emailConfirmed: true, confirmCode: preview })
              onNext()
            }}
          >
            Отвори линка от писмото
          </button>
        ) : null}
      </article>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (preview) {
            if (code.trim() !== preview) {
              onError('Кодът не съвпада.')
              return
            }
            updateProfile({ emailConfirmed: true })
            onNext()
            return
          }
          void checkEmailCode({ data: { email: profile.email, code } }).then((result) => {
            if (!result.ok) {
              onError('Кодът не съвпада.')
              return
            }
            updateProfile({ emailConfirmed: true })
            onNext()
          })
        }}
      >
        <input className={field} inputMode="numeric" placeholder="Шестцифрен код" value={code} onChange={(event) => setCode(event.target.value)} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className={ghost} type="submit">
          Въведи кода
        </button>
      </form>
    </div>
  )
}

function EgnStep({ error, onError, onNext }: { error: string; onError: (value: string) => void; onNext: () => void }) {
  const { profile } = useProfile()
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!validEgn(profile.egn)) {
          onError('ЕГН е 10 цифри и трябва да е валидно.')
          return
        }
        onNext()
      }}
    >
      <p className="leading-7">ЕГН ни трябва след потвърдения имейл, за да те разпределим и за дигиталното пълномощно. Не се показва в списъци.</p>
      <label className="grid gap-1 text-sm font-semibold">
        ЕГН
        <input className={field} inputMode="numeric" autoComplete="off" maxLength={10} value={profile.egn} onChange={(event) => updateProfile({ egn: event.target.value.replace(/\D/g, '').slice(0, 10) })} />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button className={button} type="submit">
        Напред
      </button>
    </form>
  )
}

function RoleStep({ error, onError, onNext }: { error: string; onError: (value: string) => void; onNext: () => void }) {
  const { profile } = useProfile()
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (profile.role !== 'section' && profile.role !== 'mobile') {
          onError('Избери секция или мобилен екип.')
          return
        }
        onNext()
      }}
    >
      <Choice
        selected={profile.role === 'section'}
        title="В секция"
        text="Това е за предпочитане. Хартиените секции са с предимство. Машинна секция се ползва само ако за населеното място вече има твърде много записани. Ти не избираш кое от двете."
        onClick={() => updateProfile({ role: 'section', mobileTeam: false })}
      />
      <Choice
        selected={profile.role === 'mobile'}
        title="Мобилен екип"
        text="Не си вързан за една секция и пак избираш къде можеш да бъдеш."
        onClick={() => updateProfile({ role: 'mobile', mobileTeam: true })}
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button className={button} type="submit">
        Напред
      </button>
    </form>
  )
}

function Choice({ selected, title, text, onClick }: { selected: boolean; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-[20px] border px-4 py-4 text-left ${selected ? 'border-[#53c0a4] bg-[#e4f5f0]' : 'border-[#ddd] bg-white'}`}>
      <span className="block text-lg font-extrabold">{title}</span>
      <span className="mt-1 block text-sm leading-6 text-[var(--ink-soft)]">{text}</span>
    </button>
  )
}

function Rounds({ error, onError, onNext }: { error: string; onError: (value: string) => void; onNext: () => void }) {
  const { profile } = useProfile()
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!profile.rounds.first && !profile.rounds.runoff) {
          onError('Избери поне един от двата дни.')
          return
        }
        onNext()
      }}
    >
      <p>
        {registrationSettled(profile)
          ? 'Дните са 25 октомври и 1 ноември. По-добре е да си и на двата.'
          : 'Записването е за президентските избори 2026 г. на 25 октомври и 1 ноември. По-добре е да си и на двата дни.'}
      </p>
      <label className="flex gap-3 rounded-2xl bg-white px-4 py-3">
        <input type="checkbox" checked={profile.rounds.first} onChange={(event) => updateProfile({ rounds: { ...profile.rounds, first: event.target.checked } })} />
        25 октомври
      </label>
      <label className="flex gap-3 rounded-2xl bg-white px-4 py-3">
        <input type="checkbox" checked={profile.rounds.runoff} onChange={(event) => updateProfile({ rounds: { ...profile.rounds, runoff: event.target.checked } })} />
        1 ноември, балотаж
      </label>
      {!profile.rounds.first || !profile.rounds.runoff ? <p className="text-sm">Ако можеш, остави и двата дни. Така секцията е покрита и ако има балотаж.</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button className={button} type="submit">
        Напред
      </button>
    </form>
  )
}

function ExperienceStep({ error, onError, onNext }: { error: string; onError: (value: string) => void; onNext: () => void }) {
  const { profile } = useProfile()
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!profile.experience) {
          onError('Избери едно ниво.')
          return
        }
        onNext()
      }}
    >
      {EXPERIENCE.map((item) => (
        <Choice key={item.id} selected={profile.experience === item.id} title={item.title} text={item.text} onClick={() => updateProfile({ experience: item.id as Experience })} />
      ))}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button className={button} type="submit">
        Напред
      </button>
    </form>
  )
}

function selectAddress(profile: Profile, id: string, sections: PollingSection[]) {
  if (!profile.place || !id.startsWith('address:')) return
  const group = placeSummaries(sections).find((item) => item.place === id.slice('address:'.length))
  if (!group) return
  const place = { ...profile.place, sectionId: undefined, sectionPlace: group.place, paperCount: group.paper, machineCount: group.machine }
  if (!placeChangeAllowed(profile.place, place, assignmentLocked(profile))) return
  updateProfile({ place })
}

function townPlain(name: string | undefined) {
  return (name ?? '').replace(/^(гр\.|с\.|к\.|ман\.)\s*/u, '')
}

function toggleDistant(profile: Profile, code: string) {
  const home = profile.place?.regionCode
  if (code === home || (home === 'sofia-merged' && ['23', '24', '25'].includes(code))) return
  const exists = profile.distantRegionCodes.includes(code)
  updateProfile({
    distantRegionCodes: exists ? profile.distantRegionCodes.filter((item) => item !== code) : [...profile.distantRegionCodes, code],
  })
}

function PlaceStep({ error, onError, onNext }: { error: string; onError: (value: string) => void; onNext: () => void }) {
  const { profile } = useProfile()
  const [points, setPoints] = useState<MapPoint[]>([])
  const [geography, setGeography] = useState<{ districts: CityRegion[]; sections: PollingSection[] }>({ districts: [], sections: [] })
  const outlines = useOutlines(placeOutline(profile.place))
  const assigned = assignmentLocked(profile)
  const editable = locationEditable(assigned)
  const addressKey = geography.sections.map((section) => section.id).join(',')
  useEffect(() => {
    const groups = placeSummaries(geography.sections)
    const town = townPlain(profile.place?.townName)
    if (!town || profile.place?.regionCode === '32' || groups.length === 0 || (geography.districts.length > 0 && !profile.place?.cityRegionCode)) {
      setPoints([])
      return
    }
    let cancelled = false
    setPoints([])
    void (async () => {
      const next: MapPoint[] = []
      for (const group of groups.slice(0, 25)) {
        if (cancelled) return
        const hit = await geocodePlace({ data: { query: `${group.place}, ${town}, България`, priority: 'low' } })
        if (cancelled || !hit || hit.category === 'boundary' || hit.type === 'city' || hit.type === 'administrative') continue
        const unknown = group.unknown > 0 ? `, ${group.unknown} без брой` : ''
        next.push({
          id: `address:${group.place}`,
          lat: hit.lat,
          lng: hit.lng,
          label: group.place,
          detail: `${group.sections.length} секции, ${group.paper} хартиени, ${group.machine} машинни${unknown}`,
          sectionIds: [group.place],
          tone: group.paper > 0 || group.machine === 0 ? 'paper' : 'machine',
        })
        if (!cancelled) setPoints([...next])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [addressKey, geography.districts.length, geography.sections, profile.place?.cityRegionCode, profile.place?.regionCode, profile.place?.townName])

  if (assigned && !editable) {
    return (
      <div className="grid gap-4">
        <p className="text-lg leading-7">От 19 октомври до 5 ноември мястото не се сменя.</p>
        <p>{placeLabel(profile.place)}</p>
        <button className={button} type="button" onClick={onNext}>
          Напред
        </button>
      </div>
    )
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-2 lg:items-start"
      onSubmit={(event) => {
        event.preventDefault()
        if (!placeReady(profile.place)) {
          onError('Избери място до населено място или град в чужбина.')
          return
        }
        if (!profile.radius && profile.place?.cityRegionName) updateProfile({ radius: 'cityRegion' })
        onNext()
      }}
    >
      <div className="order-1 grid gap-3 lg:sticky lg:top-20 lg:order-2">
        <BulgariaMap
          regionCodes={highlightCodes(profile.place, null, [])}
          focus={outlines.focus}
          areas={outlines.areas}
          quietCity={Boolean(profile.place?.cityRegionName) && profile.place?.regionCode !== '32'}
          waitForArea={Boolean(profile.place?.cityRegionName)}
          points={points.map((point) => ({ ...point, selected: point.id === `address:${profile.place?.sectionPlace ?? ''}` }))}
          onPoint={(id) => selectAddress(profile, id, geography.sections)}
        />
        {points.length > 0 ? (
          <p className="text-sm leading-6">Всяка точка е адрес. В прозореца са адресът, броят секции и колко са хартиени или машинни. Сивите са само машинни.</p>
        ) : null}
      </div>
      <div className="order-2 grid gap-4 lg:order-1">
        {assigned ? <p className="text-sm leading-6">Можеш да смениш района само в същия МИР, не към район от друг МИР.</p> : null}
        <PlacesPicker
          lockedMir={assigned ? mirOf(profile.place) : null}
          onGeography={setGeography}
          value={profile.place}
          onChange={(place) => {
            if (!placeChangeAllowed(profile.place, place, assigned)) {
              onError('След разпределение можеш да смениш района само в същия МИР.')
              return
            }
            const regionChanged = place?.regionCode !== profile.place?.regionCode
            const districtChanged = place?.cityRegionCode !== profile.place?.cityRegionCode
            updateProfile({
              place,
              radius: regionChanged || districtChanged ? null : profile.radius,
              distantRegionCodes: regionChanged ? [] : profile.distantRegionCodes,
              extraCityRegions: regionChanged || districtChanged ? [] : profile.extraCityRegions,
            })
          }}
        />
        {profile.place?.townId ? (
          <p className="text-sm leading-6">
            Избираш адрес, не номер на секция. Първо разпределяме към хартиените секции, тези с под 300 избиратели.
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className={button} type="submit">
          Напред
        </button>
      </div>
    </form>
  )
}

function TravelStep({ error, onError, onNext }: { error: string; onError: (value: string) => void; onNext: () => void }) {
  const { profile, ready } = useProfile()
  const outlines = useOutlines(ready ? travelOutline(profile) : [])
  if (!ready) return <div className="h-[420px] bg-[#eee]" aria-hidden />
  const assigned = assignmentLocked(profile)
  if (assigned && !locationEditable(assigned)) {
    return (
      <div className="grid gap-4">
        <p className="text-lg leading-7">От 19 октомври до 5 ноември обхватът не се сменя.</p>
        <button className={button} type="button" onClick={onNext}>
          Напред
        </button>
      </div>
    )
  }
  return (
    <form
      className="grid gap-6 lg:grid-cols-2 lg:items-start"
      onSubmit={(event) => {
        event.preventDefault()
        if (!profile.radius) {
          onError('Избери докъде можеш да стигнеш.')
          return
        }
        if (profile.radius === 'nearby' && profile.extraCityRegions.length === 0) {
          onError('Избери поне един друг район.')
          return
        }
        if (profile.radius === 'distant' && profile.place?.regionCode !== '32' && profile.distantRegionCodes.length === 0) {
          onError('Добави поне една друга област.')
          return
        }
        if (needsWiderTravel(profile.place, profile.radius)) {
          onError('На този адрес няма хартиена секция. Избери по-широк обхват.')
          return
        }
        onNext()
      }}
    >
      <div className="order-1 lg:sticky lg:top-20 lg:order-2">
        <BulgariaMap
          regionCodes={highlightCodes(profile.place, profile.radius, profile.distantRegionCodes)}
          focus={outlines.focus}
          areas={outlines.areas}
          quietCity={profile.place?.regionCode !== '32' && profile.radius !== 'region' && profile.radius !== 'distant'}
          waitForArea={profile.radius == null || profile.radius === 'cityRegion' || profile.radius === 'nearby' || profile.radius === 'settlement' || profile.radius === 'municipality'}
          interactive={profile.radius === 'distant' && profile.place?.regionCode !== '32'}
          onToggle={(code) => toggleDistant(profile, code)}
          onArea={(id) => {
            if (!id.startsWith('district:') || profile.radius !== 'nearby') return
            const code = id.slice('district:'.length)
            if (code === profile.place?.cityRegionCode) return
            const district = profile.extraCityRegions.find((item) => item.code === code)
            if (!district) return
            updateProfile({ extraCityRegions: profile.extraCityRegions.filter((item) => item.code !== code) })
          }}
        />
      </div>
      <div className="order-2 grid gap-4 lg:order-1">
        <p className="leading-7">Запазено място: {placeLabel(profile.place)}.</p>
        <TravelChoice profile={profile} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className={button} type="submit">
          Напред
        </button>
      </div>
    </form>
  )
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      {([[true, 'Да'], [false, 'Не']] as const).map(([answer, text]) => (
        <label key={text} className="flex gap-3 rounded-2xl bg-white px-4 py-3">
          <input type="radio" checked={value === answer} onChange={() => onChange(answer)} />
          {text}
        </label>
      ))}
    </fieldset>
  )
}

function Seats({ error, onError, onNext }: { error: string; onError: (value: string) => void; onNext: () => void }) {
  const { profile } = useProfile()
  const mobile = profile.role === 'mobile'
  const askSeats = !mobile || profile.hasCar === true
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (mobile && (profile.hasCar === null || profile.hasDrone === null)) {
          onError('Отговори за колата и за дрона.')
          return
        }
        onNext()
      }}
    >
      {mobile ? <YesNo label="Имаш ли кола?" value={profile.hasCar} onChange={(hasCar) => updateProfile({ hasCar, carSeats: hasCar ? profile.carSeats : 0 })} /> : null}
      {askSeats ? (
        <>
          <p>Колко души можеш да вземеш, освен себе си. 0 значи, че не возиш никого.</p>
          <div className="flex items-center justify-between gap-3">
            <button type="button" className="h-14 w-14 rounded-full border border-[#ddd] bg-white text-3xl font-bold" onClick={() => updateProfile({ carSeats: Math.max(0, profile.carSeats - 1) })}>
              −
            </button>
            <span className="text-3xl font-extrabold">{profile.carSeats}</span>
            <button type="button" className="h-14 w-14 rounded-full border border-[#ddd] bg-white text-3xl font-bold" onClick={() => updateProfile({ carSeats: Math.min(6, profile.carSeats + 1) })}>
              +
            </button>
          </div>
        </>
      ) : null}
      {mobile ? <YesNo label="Имаш дрон или можеш да го оперираш?" value={profile.hasDrone} onChange={(hasDrone) => updateProfile({ hasDrone })} /> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button className={button} type="submit">
        Напред
      </button>
    </form>
  )
}

function People({
  companion,
  setCompanion,
  error,
  onError,
  onNext,
  unsentLinks,
}: {
  companion: Companion
  setCompanion: (value: Companion) => void
  error: string
  onError: (value: string) => void
  onNext: () => void
  unsentLinks: { email: string; link: string }[]
}) {
  const { profile } = useProfile()

  function add() {
    if (!validName(companion.firstName) || !validName(companion.lastName) || !validEmail(companion.email) || !validPhone(companion.phone)) {
      onError('За пазител в групата трябват име, фамилия, имейл и телефон.')
      return
    }
    if (!companion.samePlace && !companion.role) {
      onError('Избери роля, или остави същите място и дни като теб.')
      return
    }
    onError('')
    const filled: Companion = companion.samePlace
      ? { ...companion, mode: 'full', inGroup: !profile.coordinator, role: profile.role, mobileTeam: profile.mobileTeam, rounds: profile.rounds, experience: profile.experience }
      : { ...companion, mode: 'full', inGroup: !profile.coordinator }
    updateProfile({ companions: [...profile.companions, { ...filled, id: crypto.randomUUID() }] })
    setCompanion(blankCompanion())
  }

  return (
    <div className="grid gap-4">
      <p className="leading-7">
        {profile.coordinator
          ? 'Тези хора не са в твоята група. Записваш ги като координатор и всеки потвърждава своя имейл.'
          : 'Ако идвате заедно, добави пазителите в групата. Можеш няколко. Всеки потвърждава своя имейл.'}
      </p>
      <button type="button" className="text-left font-bold text-[#2b062f]" onClick={() => updateProfile({ coordinator: !profile.coordinator })}>
        {profile.coordinator ? 'Добавям към моята група' : 'Добавям хора извън групата, като координатор'}
      </button>
      <div className="grid gap-2">
        <input className={field} autoComplete="given-name" placeholder="Име" value={companion.firstName} onChange={(event) => setCompanion({ ...companion, firstName: event.target.value })} />
        <input className={field} autoComplete="additional-name" placeholder="Презиме" value={companion.middleName} onChange={(event) => setCompanion({ ...companion, middleName: event.target.value })} />
        <input className={field} autoComplete="family-name" placeholder="Фамилия" value={companion.lastName} onChange={(event) => setCompanion({ ...companion, lastName: event.target.value })} />
        <input className={field} autoComplete="email" placeholder="Имейл" value={companion.email} onChange={(event) => setCompanion({ ...companion, email: event.target.value })} />
        <input className={field} autoComplete="tel" placeholder="Телефон" value={companion.phone} onChange={(event) => setCompanion({ ...companion, phone: event.target.value })} />
        <label className="flex gap-2 text-sm leading-6">
          <input type="checkbox" checked={companion.samePlace} onChange={(event) => setCompanion({ ...companion, samePlace: event.target.checked })} />
          Същите място, дни и роля като мен
        </label>
        {!companion.samePlace ? (
          <label className="grid gap-1 text-sm font-semibold">
            Роля
            <select
              className={field}
              value={companion.role === 'mobile' ? 'mobile' : companion.role === 'section' ? 'section' : ''}
              onChange={(event) => {
                const role = (event.target.value || null) as Role | null
                setCompanion({ ...companion, role, mobileTeam: role === 'mobile' })
              }}
            >
              <option value="">Избери</option>
              <option value="section">Секция</option>
              <option value="mobile">Мобилен екип</option>
            </select>
          </label>
        ) : null}
        <button type="button" className={ghost} onClick={add}>
          Добави пазител
        </button>
      </div>
      {profile.companions.length > 0 ? (
        <ul className="grid gap-2">
          {profile.companions.map((person) => {
            const unsent = unsentLinks.find((item) => item.email === person.email.trim().toLowerCase())
            return (
            <li key={person.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-white px-4 py-3">
              <span>
                {person.firstName} {person.lastName}
                <span className="block text-sm text-[#666]">{person.inGroup === false ? 'Извън групата' : 'В групата'} · {person.email}</span>
                {unsent ? (
                  <span className="block text-sm text-[#666]">
                    Писмото не тръгна. Прати им линка: <a href={unsent.link}>{unsent.link}</a>
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                className="font-bold text-[#2b062f]"
                onClick={() => updateProfile({ companions: profile.companions.filter((item) => item.id !== person.id) })}
              >
                Махни
              </button>
            </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm leading-6">Може и без група. Повечето хора се записват сами.</p>
      )}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button type="button" className={button} onClick={onNext}>
        {registrationSettled(profile) || profile.companions.length > 0 ? 'Напред' : 'Продължи без група'}
      </button>
    </div>
  )
}

function Review({ settled, error, onError }: { settled: boolean; error: string; onError: (value: string) => void }) {
  const { profile } = useProfile()
  const navigate = useNavigate()
  const experience = EXPERIENCE.find((item) => item.id === profile.experience)
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!profile.consent) {
          onError('Нужно е потвърждението в края.')
          return
        }
        updateProfile({ submitted: true, withdrawn: false })
        void navigate({ to: '/profil' })
      }}
    >
      <ul className="grid gap-2 rounded-2xl bg-white p-4 leading-7">
        <li>
          {profile.firstName} {profile.middleName} {profile.lastName}
        </li>
        <li>
          {profile.email} · {profile.phone}
        </li>
        <li>{roleLabel(profile.role, profile.mobileTeam)}</li>
        <li>
          Президентски избори 2026 г.
          {profile.rounds.first ? ' · 25 октомври' : ''}
          {profile.rounds.runoff ? ' · 1 ноември' : ''}
        </li>
        <li>{experience?.title}</li>
        {profile.role !== 'video' ? (
          <>
            <li>{placeLabel(profile.place)}</li>
            <li>{radiusOptions(profile.place).find((item) => item.id === profile.radius)?.label}</li>
            {profile.role === 'mobile' ? <li>{profile.hasCar ? `Кола, ${profile.carSeats} свободни места` : 'Без кола'}</li> : profile.carSeats > 0 ? <li>{profile.carSeats} свободни места</li> : null}
            {profile.role === 'mobile' ? <li>{profile.hasDrone ? 'Има дрон' : 'Без дрон'}</li> : null}
          </>
        ) : null}
        <li>
          {profile.companions.filter((person) => person.inGroup !== false).length === 0
            ? 'Без група'
            : `Група: ${profile.companions
                .filter((person) => person.inGroup !== false)
                .map((person) => `${person.firstName} ${person.lastName}`)
                .join(', ')}`}
        </li>
        {profile.companions.some((person) => person.inGroup === false) ? (
          <li>
            Като координатор:{' '}
            {profile.companions
              .filter((person) => person.inGroup === false)
              .map((person) => `${person.firstName} ${person.lastName}`)
              .join(', ')}
          </li>
        ) : null}
      </ul>
      <StaffNote />
      <p className="leading-7">Хартиените секции са с предимство. Машинна секция се използва само ако за населеното място вече има твърде много записани.</p>
      <label className="flex items-start gap-3 rounded-2xl bg-white px-4 py-4 leading-7">
        <input type="checkbox" className="mt-1" checked={profile.consent} onChange={(event) => updateProfile({ consent: event.target.checked })} />
        <span>
          Разбирам, че това е доброволна дейност без заплащане и че ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев. Запознат съм с{' '}
          <Link to="/privacy-notice">декларацията за поверителност</Link>.
        </span>
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button className={button} type="submit">
        {settled ? 'Запази' : 'Запиши ме'}
      </button>
    </form>
  )
}

function useReviewCopy(step: string, profile: Profile, ready: boolean) {
  // Freeze the first-time title once a real profile is on screen. A later submitted
  // flag with the same consent is a load from the server, not the consent checkbox.
  const locked = useRef<{ settled: boolean; consent: boolean } | null>(null)
  if (step !== 'review') locked.current = null
  else if (ready && profile.email.includes('@') && locked.current === null) {
    locked.current = { settled: registrationSettled(profile), consent: profile.consent }
  } else if (locked.current && !locked.current.settled && profile.submitted && profile.consent === locked.current.consent && registrationSettled(profile)) {
    locked.current = { settled: true, consent: profile.consent }
  }
  if (!ready || step !== 'review') return ready && registrationSettled(profile)
  return locked.current?.settled === true
}

function LegalNotice() {
  return (
    <p className="rounded-xl bg-[#eee] px-3 py-3 text-sm leading-6 text-[#333]">
      Това е доброволна дейност без заплащане. Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.
    </p>
  )
}

function blankCompanion(): Companion {
  return {
    id: '',
    mode: 'full',
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
    phone: '',
    role: null as Role | null,
    mobileTeam: false,
    rounds: { first: true, runoff: true },
    experience: null,
    samePlace: true,
    inGroup: true,
    status: 'pending',
  }
}

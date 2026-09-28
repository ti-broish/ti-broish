import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AssignedSectionMap } from '../components/AssignedSectionMap'
import { ProfileSummary } from '../components/ProfileSummary'
import { PageIntro } from '../components/SiteChrome'
import { ShareSignup } from '../components/ShareSignup'
import { StaffNote } from '../components/StaffNote'
import { loadSignup, saveSignup } from '../signup/db'
import { isProtocolDay } from '../signup/election'
import { assignmentLocked, nextAssignment, profileView, signupGap, type Profile } from '../signup/model'
import { locationEditable, mirOf } from '../signup/rules'
import { rememberReport } from '../signup/report-memory'
import { submitCall } from '../signup/reports'
import { ensureReferralCode, updateProfile, useProfile } from '../signup/store'

export const Route = createFileRoute('/profil')({ component: ProfilePage })

function AnonymousCall() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3'
  if (done) return <p>Записахме, че искаш обаждане. Екипът ще ти звънне на {phone}.</p>
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setError('')
        void submitCall({ data: { name, phone, email: '', message } }).then((result) => {
          if (!result.ok) {
            setError(result.message)
            return
          }
          rememberReport({ id: result.id, secret: result.secret, kind: 'call' })
          setDone(true)
        })
      }}
    >
      <p className="leading-7">Ако искаш обаждане, без да се записваш, остави телефон.</p>
      <input className={field} autoComplete="name" placeholder="Име" value={name} onChange={(event) => setName(event.target.value)} required />
      <input className={field} type="tel" autoComplete="tel" placeholder="Телефон" value={phone} onChange={(event) => setPhone(event.target.value)} required />
      <textarea className={`${field} min-h-24 py-2`} placeholder="По какъв въпрос" value={message} onChange={(event) => setMessage(event.target.value)} />
      {error ? <p className="text-red-700">{error}</p> : null}
      <button className="brand-button" type="submit">
        Поискай обаждане
      </button>
    </form>
  )
}

function ProfilePage() {
  const { profile, ready } = useProfile()
  const [inviteLink, setInviteLink] = useState('')
  const [referralCount, setReferralCount] = useState(0)
  const [synced, setSynced] = useState(false)
  const [unsentCompanionLinks, setUnsentCompanionLinks] = useState<{ email: string; link: string }[]>([])
  const skipSave = useRef(true)
  useEffect(() => {
    if (!profile.emailConfirmed) return
    const code = ensureReferralCode(profile)
    setInviteLink(`${window.location.origin}/signup?ref=${code}`)
  }, [profile])
  useEffect(() => {
    let cancelled = false
    void loadSignup().then((remote) => {
      if (cancelled) return
      if (remote) {
        updateProfile({ ...remote.profile, referrerName: remote.referrerName })
        setReferralCount(remote.referralCount)
      }
      setSynced(true)
    })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    if (!synced) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    if (!profile.email.includes('@')) return
    const handle = window.setTimeout(() => {
      void saveSignup({ data: profile }).then((result) => {
        if (result.ok && result.pendingLinks.length > 0) setUnsentCompanionLinks(result.pendingLinks)
      })
    }, 600)
    return () => window.clearTimeout(handle)
  }, [synced, profile])

  if (!ready) return <p>Зареждаме профила…</p>
  if (!profile.email) {
    return (
      <div className="grid gap-4">
        <PageIntro title="Още нямаш профил" lede="Запиши се. Сигнал можеш да изпратиш и без профил." />
        <Link to="/signup" search={{ step: 'contact' }} className="brand-button">
          Запиши се
        </Link>
        <p className="text-sm leading-7">
          <Link to="/signal">Подай сигнал</Link>
          {isProtocolDay() ? (
            <>
              {' · '}
              <Link to="/protokol">Изпрати протокол</Link>
            </>
          ) : null}
        </p>
        <AnonymousCall />
      </div>
    )
  }

  const view = profileView(profile)
  const assigned = assignmentLocked(profile)
  const canEditPlace = locationEditable(assigned)

  return (
    <div className="grid gap-8">
      <PageIntro title={`${profile.firstName}, това е профилът ти`} />
      <NextStep profile={profile} />
      <ProfileSummary profile={profile} />
      <div className="grid gap-2">
        <Link to="/signup" search={{ step: 'contact' }} className="font-bold">
          Промени данните
        </Link>
        {canEditPlace ? (
          <Link to="/signup" search={{ step: 'place' }} className="font-bold">
            Промени мястото{assigned && mirOf(profile.place) ? ` в МИР ${mirOf(profile.place)}` : ''}
          </Link>
        ) : (
          <p className="leading-7">От 19 октомври до 5 ноември мястото не се сменя.</p>
        )}
      </div>

      <section className="grid gap-3 border-t border-[var(--line)] pt-6">
        <h2 className="text-xl font-black text-[#444]">Материали</h2>
        <p className="leading-7">Прочети ги преди изборния ден. Пълномощното идва след разпределението, в изборната седмица.</p>
        <Link to="/instructions" className="font-bold">
          Инструкции за секцията
        </Link>
        <a className="font-bold" href="https://tibroish.bg/files/Narachnik-Ti-broish.pdf">
          Наръчник на пазителя
        </a>
        {view === 'assigned' ? null : (
          <Link to="/znachka" className="font-bold">
            Значка за печат, още сега
          </Link>
        )}
      </section>

      <section className="grid gap-4 border-t border-[var(--line)] pt-6">
        <h2 className="text-xl font-black text-[#444]">Покани</h2>
        {inviteLink ? <ShareSignup link={inviteLink} count={referralCount} /> : null}
        {profile.companions.length > 0 ? (
          <ul className="grid gap-2">
            {profile.companions.map((person) => {
              const unsent = person.status === 'confirmed' ? undefined : unsentCompanionLinks.find((item) => item.email === person.email)
              return (
                <li key={person.id}>
                  {person.firstName} {person.lastName} · {person.status === 'confirmed' ? 'потвърден имейл' : 'чака потвърждение'}
                  {unsent ? (
                    <span className="block text-sm text-[#666]">
                      Писмото не тръгна. Прати им линка: <a href={unsent.link}>{unsent.link}</a>
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="leading-7">
            {inviteLink ? 'Още няма поканени. Сподели линка, за да дойдат с теб.' : 'Още няма поканени. Поканата се отключва, след като потвърдиш имейла.'}
          </p>
        )}
      </section>

      <section className="grid gap-4 border-t border-[var(--line)] pt-6">
        <StaffNote />
        <p>
          <Link to="/signal">Подай сигнал</Link>
          {isProtocolDay() ? (
            <>
              {' · '}
              <Link to="/protokol">Изпрати протокол</Link>
            </>
          ) : null}
          {' · '}
          <Link to="/izprateni">Изпратените</Link>
        </p>
        {!profile.withdrawn ? (
          <button
            type="button"
            className="flex min-h-14 w-full items-center justify-center rounded-[20px] border border-[#333] bg-white px-5 text-xl font-bold"
            onClick={() => updateProfile({ withdrawn: true, submitted: true })}
          >
            Оттегли записването
          </button>
        ) : null}
        <p className="text-sm leading-6">
          Това е доброволна дейност без заплащане. Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев.
        </p>
      </section>
    </div>
  )
}

function NextStep({ profile }: { profile: Profile }) {
  const view = profileView(profile)
  if (view === 'incomplete') {
    return (
      <section className="grid gap-4" aria-label={profile.withdrawn ? 'Оттеглено' : 'Още една стъпка'}>
        <p className="text-sm font-bold text-[#666]">{profile.withdrawn ? 'Оттеглено' : 'Още една стъпка'}</p>
        <h2 className="text-3xl font-black text-[#444]">
          {profile.withdrawn ? 'Записването е оттеглено' : 'Записването не е готово'}
        </h2>
        <p className="text-lg leading-7">{profile.withdrawn ? 'Мястото се освобождава. Можеш да го върнеш, ако още искаш да участваш.' : signupGap(profile)}</p>
        {profile.withdrawn ? (
          <button type="button" className="brand-button" onClick={() => updateProfile({ withdrawn: false, submitted: true })}>
            Върни записването
          </button>
        ) : (
          <Link to="/signup" search={{ step: resumeStep(profile) }} className="brand-button">
            Продължи записването
          </Link>
        )}
      </section>
    )
  }
  if (view === 'assigned') {
    return (
      <section className="grid gap-3" aria-label="Назначена секция">
        <p className="text-sm font-bold text-[#666]">Назначена секция</p>
        <h2 className="text-3xl font-black text-[#444]">
          {profile.assignedSection}
        </h2>
        {profile.place?.sectionPlace ? <p className="leading-7">{profile.place.sectionPlace}</p> : null}
        <p className="text-lg leading-7">
          {profile.rounds.first ? '25 октомври' : '1 ноември'}. Секцията е публикувана от екипа. Отпечатай значката и я вземи в изборния ден.
        </p>
        {profile.assignedSection ? <AssignedSectionMap place={profile.place} section={profile.assignedSection} /> : null}
        <Link to="/znachka" className="brand-button">
          Отпечатай значката
        </Link>
      </section>
    )
  }
  const wave = nextAssignment(profile)
  return (
    <section className="grid gap-3" aria-label="Следващо за теб">
      <p className="text-sm font-bold text-[#666]">Следващо за теб</p>
      <h2 className="text-3xl font-black text-[#444]">
        {wave?.label}
      </h2>
      <p className="text-lg leading-7">На тази дата виждаш секцията тук и получаваш имейл. Дотогава няма назначена секция.</p>
    </section>
  )
}

function resumeStep(profile: Profile) {
  if (!profile.firstName || !profile.email || !profile.phone) return 'contact' as const
  if (!profile.emailConfirmed) return 'confirm' as const
  if (!profile.egn) return 'egn' as const
  if (!profile.role || profile.role === 'video') return 'role' as const
  if (!profile.experience) return 'experience' as const
  if (!profile.place) return 'place' as const
  if (!profile.radius) return 'travel' as const
  return 'review' as const
}

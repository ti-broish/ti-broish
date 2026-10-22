import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AssignedSectionMap } from '../components/AssignedSectionMap'
import { loadAssignedSectionPlace } from '../signup/assigned-section-load'
import type { AssignedSectionPlace } from '../signup/assigned-section-place'
import { OwnDesignationCard, useOwnDesignation } from '../components/OwnDesignationCard'
import { ProfileSummary } from '../components/ProfileSummary'
import { PageIntro } from '../components/SiteChrome'
import { ShareSignup } from '../components/ShareSignup'
import { StaffNote } from '../components/StaffNote'
import { checkEmailCode, requestSignInCode } from '../signup/confirm-mail'
import { applyCantReachReport } from '../signup/cant-reach'
import { reportCantReach, saveSignup } from '../signup/db'
import { selfRestoreSignup } from '../signup/admin-unregister-actions'
import { applyLoadedSession, beginSessionLoad, invalidateSessionLoad } from '../signup/use-registration'
import { isProtocolDay } from '../signup/election'
import { assignmentLocked, nextAssignment, profileView, resumeSignupStep, signupGap, validEmail, type Profile } from '../signup/model'
import { locationEditable, mirOf } from '../signup/rules'
import { rememberReport } from '../signup/report-memory'
import { submitCall } from '../signup/reports'
import { ensureReferralCode, updateProfile, useProfile } from '../signup/store'

export const Route = createFileRoute('/profil')({ component: ProfilePage })

function ProfileSignIn() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState('')
  const [phase, setPhase] = useState<'email' | 'code'>('email')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3'

  if (phase === 'code') {
    return (
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setError('')
          setBusy(true)
          void checkEmailCode({ data: { email, code } }).then((result) => {
            if (!result.ok) {
              setBusy(false)
              setError('Кодът не съвпада.')
              return
            }
            invalidateSessionLoad()
            window.location.assign('/profil')
          })
        }}
      >
        <p className="leading-7">{preview ? `Оттук писмото не тръгва. Кодът е ${preview}.` : `Изпратихме код на ${email}.`}</p>
        <label className="grid gap-1 text-sm font-semibold">
          Код от писмото
          <input className={field} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className="brand-button" type="submit" disabled={busy}>
          Влез
        </button>
      </form>
    )
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        const entered = email.trim()
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
              setError('Няма потвърдено записване с този имейл.')
              return
            }
            if (result.status === 'failed' || result.status === 'unavailable') {
              setError('Писмото не тръгна. Опитай отново след малко.')
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
      <p className="leading-7">Ако вече си се записал, влез с имейла. Пращаме шестцифрен код.</p>
      <label className="grid gap-1 text-sm font-semibold">
        Имейл
        <input className={field} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button className="brand-button" type="submit" disabled={busy}>
        Изпрати код
      </button>
    </form>
  )
}

function AnonymousCall() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3'
  if (done) return <p>Приехме молбата. Екипът ще ти звънне на {phone}.</p>
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
      <p className="leading-7">Ако искаш обаждане, без да се записваш, остави име и телефон.</p>
      <label className="grid gap-1 text-sm font-semibold">
        Име
        <input className={field} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Телефон
        <input className={field} type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        За какво е обаждането
        <textarea className={`${field} min-h-24 py-2`} value={message} onChange={(event) => setMessage(event.target.value)} />
      </label>
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
  const designation = useOwnDesignation(ready && Boolean(profile.email))
  useEffect(() => {
    if (!profile.emailConfirmed) return
    const code = ensureReferralCode(profile)
    setInviteLink(`${window.location.origin}/signup?ref=${code}`)
  }, [profile])
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const current = beginSessionLoad(profile)
    void current.pending.then((remote) => {
      if (cancelled) return
      if (remote) {
        updateProfile((latest) => applyLoadedSession(latest, remote, current.at))
        setReferralCount(remote.referralCount)
      }
      setSynced(true)
    })
    return () => {
      cancelled = true
    }
  }, [ready])
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
        if (result.ok && result.renewedCallAt && result.renewedCallAt !== profile.callRequestedAt) {
          updateProfile({ callRequestedAt: result.renewedCallAt })
        }
      })
    }, 600)
    return () => window.clearTimeout(handle)
  }, [synced, profile])

  if (!ready) return <p>Зареждаме профила…</p>
  if (!profile.email) {
    return (
      <div className="grid gap-4">
        <PageIntro title="Още нямаш профил" lede="Влез с имейла, ако вече си се записал. Иначе се запиши. Сигнал можеш да изпратиш и без профил." />
        <ProfileSignIn />
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
      {designation ? <OwnDesignationCard designation={designation} /> : null}
      <PageIntro title={`${profile.firstName}, това е профилът ти`} />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-8">
          <NextStep profile={profile} />
          <div className="grid gap-2">
            <Link to="/signup" search={{ step: 'contact' }} className="font-bold">
              Промени данните
            </Link>
            {canEditPlace ? (
              <Link to="/signup" search={{ step: 'place' }} className="font-bold">
                Промени мястото{assigned && mirOf(profile.place) ? ` в МИР ${mirOf(profile.place)}` : ''}
              </Link>
            ) : (
              <p className="leading-7">От 19 октомври до 5 ноември не можеш да смениш мястото.</p>
            )}
          </div>
          <section className="grid gap-3 border-t border-[var(--line)] pt-6">
            <h2 className="text-xl font-black text-[#444]">Материали</h2>
            <p className="leading-7">
              {designation
                ? 'Прочети ги преди изборния ден.'
                : 'Прочети ги преди изборния ден. Дигиталното пълномощно идва след секцията, в изборната седмица.'}
            </p>
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
                {inviteLink ? 'Още няма поканени. Сподели линка, за да дойдат с теб.' : 'Още няма поканени. Поканата се появява, след като потвърдиш имейла.'}
              </p>
            )}
          </section>
        </div>
        <div className="lg:sticky lg:top-20">
          <ProfileSummary profile={profile} />
        </div>
      </div>

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
            onClick={() => updateProfile({ withdrawn: true, submitted: true, withdrawnByAdmin: false, assignedSection: '' })}
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

function assignedDays(profile: Profile) {
  const days = [profile.rounds.first ? '25 октомври' : '', profile.rounds.runoff ? '1 ноември' : ''].filter(Boolean)
  return days.join(' и ') || 'Изборният ден'
}

const secondaryButton =
  'flex min-h-12 w-full items-center justify-center rounded-[20px] border border-[#333] bg-white px-5 text-lg font-bold'

function CantReachSection({ profile }: { profile: Profile }) {
  const section = profile.assignedSection!
  const reported = profile.cantReachSection?.section === section
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3 py-2'

  if (reported) {
    return (
      <p className="text-lg leading-7" role="status">
        Получихме го. Екипът ще ти звънне{profile.phone ? ` на ${profile.phone}` : ''}, за да намерим решение.
      </p>
    )
  }

  if (!open) {
    return (
      <button type="button" className={secondaryButton} onClick={() => setOpen(true)}>
        Няма да мога да стигна до секцията
      </button>
    )
  }

  return (
    <form
      className="grid gap-3 rounded-2xl border border-[#ddd] bg-[#faf8fb] p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy) return
        setBusy(true)
        const now = new Date().toISOString()
        const next = applyCantReachReport({
          callMessage: profile.callMessage,
          callRequestedAt: profile.callRequestedAt,
          section,
          note,
          now,
        })
        updateProfile({
          callMessage: next.callMessage,
          callRequestedAt: next.callRequestedAt,
          cantReachSection: next.cantReachSection,
        })
        void reportCantReach({ data: { note } })
          .then((result) => {
            if (result.ok) {
              updateProfile({
                callMessage: result.callMessage,
                callRequestedAt: result.callRequestedAt,
                cantReachSection: result.cantReachSection,
              })
            }
          })
          .finally(() => {
            setBusy(false)
            setOpen(false)
          })
      }}
    >
      <label className="grid gap-1 text-sm font-semibold">
        Какво се случи? (по желание)
        <textarea
          className={`${field} min-h-24`}
          maxLength={400}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Например няма транспорт или си болен."
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="brand-button" disabled={busy}>
          Изпрати на екипа
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={busy}
          onClick={() => {
            setOpen(false)
            setNote('')
          }}
        >
          Отказ
        </button>
      </div>
    </form>
  )
}

/** Address and settlement of the assigned section itself, never the place picked at signup. */
function AssignedSectionWhere({ place }: { place: AssignedSectionPlace | null }) {
  if (!place) return null
  return (
    <div className="grid gap-1" aria-label="Адрес на секцията">
      {place.address ? <p className="leading-7">{place.address}</p> : null}
      {place.settlement ? <p className="font-bold leading-7">{place.settlement}</p> : null}
    </div>
  )
}

function useAssignedSectionPlace(section: string | null) {
  const [loaded, setLoaded] = useState<{ section: string; place: AssignedSectionPlace | null } | null>(null)
  useEffect(() => {
    if (!section) {
      setLoaded(null)
      return
    }
    let cancelled = false
    void loadAssignedSectionPlace()
      .then((result) => {
        if (cancelled) return
        // A lookup for another section (or none) shows the code only.
        setLoaded({ section, place: result && result.section === section ? result.place : null })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ section, place: null })
      })
    return () => {
      cancelled = true
    }
  }, [section])
  return loaded
}

function NextStep({ profile }: { profile: Profile }) {
  const view = profileView(profile)
  const assigned = useAssignedSectionPlace(view === 'assigned' ? profile.assignedSection : null)
  if (view === 'incomplete') {
    const adminUnregistered = profile.withdrawn && profile.withdrawnByAdmin
    const selfWithdrawn = profile.withdrawn && !profile.withdrawnByAdmin
    return (
      <section
        className="grid gap-4"
        aria-label={adminUnregistered ? 'Отписан' : selfWithdrawn ? 'Оттеглено' : 'Още една стъпка'}
      >
        <p className="text-sm font-bold text-[#666]">
          {adminUnregistered ? 'Отписан' : selfWithdrawn ? 'Оттеглено' : 'Още една стъпка'}
        </p>
        <h2 className="text-3xl font-black text-[#444]">
          {adminUnregistered
            ? 'Записването е отписано'
            : selfWithdrawn
              ? 'Записването е оттеглено'
              : 'Записването не е готово'}
        </h2>
        <p className="text-lg leading-7">
          {adminUnregistered
            ? 'Вече не си в активните списъци. Ако искаш отново да участваш, върни записването или ни пиши.'
            : selfWithdrawn
              ? 'Мястото се освобождава. Можеш да го върнеш, ако още искаш да участваш.'
              : signupGap(profile)}
        </p>
        {adminUnregistered ? (
          <div className="grid gap-2">
            <button
              type="button"
              className="brand-button"
              onClick={() => {
                updateProfile({ withdrawn: false, submitted: true, withdrawnByAdmin: false })
                void selfRestoreSignup().then((result) => {
                  if (!result.ok) updateProfile({ withdrawn: true, withdrawnByAdmin: true })
                })
              }}
            >
              Запиши се отново
            </button>
            <Link to="/kontakt" className={secondaryButton}>
              Пиши ни
            </Link>
          </div>
        ) : selfWithdrawn ? (
          <button
            type="button"
            className="brand-button"
            onClick={() => updateProfile({ withdrawn: false, submitted: true, withdrawnByAdmin: false })}
          >
            Върни записването
          </button>
        ) : (
          <Link to="/signup" search={{ step: resumeSignupStep(profile) }} className="brand-button">
            Продължи записването
          </Link>
        )}
      </section>
    )
  }
  if (view === 'assigned') {
    const assignedPlace = assigned?.section === profile.assignedSection ? assigned.place : null
    return (
      <section className="grid gap-3" aria-label="Назначена секция">
        <p className="text-sm font-bold text-[#666]">Назначена секция</p>
        <h2 className="text-3xl font-black text-[#444]">
          {profile.assignedSection}
        </h2>
        <AssignedSectionWhere place={assignedPlace} />
        <p className="text-lg leading-7">
          {assignedDays(profile)}. Екипът вече е определил секцията. Отпечатай значката и я вземи в изборния ден.
        </p>
        {profile.assignedSection ? (
          <AssignedSectionMap place={profile.place} section={profile.assignedSection} assigned={assignedPlace} />
        ) : null}
        <Link to="/znachka" className="brand-button">
          Отпечатай значката
        </Link>
        {!profile.withdrawn && profile.assignedSection ? <CantReachSection profile={profile} /> : null}
      </section>
    )
  }
  const wave = nextAssignment(profile)
  return (
    <section className="grid content-start gap-3" aria-label="Записан си">
      <h2 className="text-3xl font-black text-[#444]">Записан си</h2>
      <p className="text-lg leading-7">Секцията още не е потвърдена.</p>
      <h3 className="text-2xl font-black text-[#444]">{wave?.label}</h3>
      <p className="text-lg leading-7">На тази дата я виждаш тук и получаваш писмо.</p>
    </section>
  )
}



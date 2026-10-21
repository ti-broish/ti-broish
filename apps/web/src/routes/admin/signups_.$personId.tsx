import { MobileDraftCard } from './-mobile-teams'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { AdminHeading, adminInput } from '../../components/admin-ui'
import { EgnReveal } from '../../components/EgnReveal'
import { StaffTravel, type StaffTravelValue } from '../../components/StaffTravel'
import { adminPerson, adminUpdatePerson } from '../../signup/admin'
import { adminSectionPlaces } from '../../signup/admin-section-places'
import { assignedPlaceFromSpot, assignedSectionLine } from '../../signup/assigned-section-place'
import { describeAudit, formatAuditWhen, type AuditLine } from '../../signup/admin-audit'
import { progressLabel, roleLabel, signupProgress, type AdminPerson } from '../../signup/admin-progress'
import { defaultSignupSearch } from '../../signup/admin-search'
import { CALLED_LABEL, calledText } from '../../signup/call-reopen'
import { EXPERIENCE, type Experience, type NamedPlace, type Radius, type Role, type TravelStop } from '../../signup/model'
import { UnregisterPanel } from './-unregister-panel'
import { ReservedBadge, reservedOrgFor, useReservedIndex } from './-reserved-badge'

export const Route = createFileRoute('/admin/signups_/$personId')({
  component: PersonPage,
})

const field = `${adminInput} w-full`

interface PersonForm {
  firstName: string
  middleName: string
  lastName: string
  phone: string
  role: Role | ''
  roundsFirst: boolean
  roundsRunoff: boolean
  experience: Experience | ''
  called: boolean
  staffNote: string
  radius: Radius | ''
  extraCityRegions: NamedPlace[]
  distantRegionCodes: string[]
  travelMunicipalities: TravelStop[]
}

function PersonPage() {
  const { personId } = Route.useParams()
  const access = useAdminAccess()
  const [person, setPerson] = useState<AdminPerson | null>(null)
  const [changes, setChanges] = useState<AuditLine[]>([])
  const [form, setForm] = useState<PersonForm | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const canEdit = access.permissions.edit

  const reload = useCallback(() => {
    setPhase('loading')
    setSaved(false)
    setMessage('')
    void adminPerson({ data: { id: personId } }).then((result) => {
      if (!result.ok) {
        setPhase(result.message === 'Няма такъв човек.' ? 'missing' : 'error')
        setMessage(result.message)
        return
      }
      setPerson(result.person)
      setChanges(result.changes)
      setForm(formFrom(result.person))
      setPhase('ready')
    }).catch(() => {
      setPhase('error')
      setMessage('Човекът не се зареди.')
    })
  }, [personId])

  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    setPerson(null)
    setChanges([])
    setForm(null)
    setSaved(false)
    setMessage('')
    void adminPerson({ data: { id: personId } }).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setPhase(result.message === 'Няма такъв човек.' ? 'missing' : 'error')
        setMessage(result.message)
        return
      }
      setPerson(result.person)
      setChanges(result.changes)
      setForm(formFrom(result.person))
      setPhase('ready')
    }).catch(() => {
      if (cancelled) return
      setPhase('error')
      setMessage('Човекът не се зареди.')
    })
    return () => {
      cancelled = true
    }
  }, [personId])

  const title = person ? personName(person) || person.email : 'Записване'

  return (
    <div className="grid max-w-3xl gap-5">
      <Link to="/admin/signups" search={defaultSignupSearch} className="text-sm font-bold text-[#2b062f] underline">
        Към записванията
      </Link>
      <AdminHeading title={title} lede={person ? progressSentence(person) : undefined} />
      {phase === 'loading' ? <p className="text-sm font-bold text-[#1a1020]">Зареждаме човека…</p> : null}
      {phase === 'missing' || phase === 'error' ? (
        <p className="rounded-xl border-2 border-[#8f1d1d] bg-[#fff5f5] px-3 py-2 text-sm font-bold text-[#8f1d1d]" role="alert">
          {message || 'Няма такъв човек.'}
        </p>
      ) : null}
      {person && form ? (
        <>
          <div className="flex flex-wrap gap-1">
            <span className={`inline-flex min-h-7 items-center rounded-full px-2 text-xs font-bold ${progressClass(person)}`}>
              {progressLabel(signupProgress(person))}
            </span>
            {person.staffCalledAt ? (
              <span className="inline-flex min-h-7 items-center rounded-full bg-[#1f4d7a] px-2 text-xs font-bold text-white">{CALLED_LABEL}</span>
            ) : null}
          </div>
          <PersonFacts
            person={person}
            canRevealEgn={access.permissions.revealEgn}
            onEgnRevealed={(audit) => {
              if (audit) setChanges((prev) => [audit, ...prev.filter((line) => line.id !== audit.id)])
            }}
          />
          <ReservedNotice codes={[person.publishedSection, person.draftSection]} />
          <MobileDraftCard personId={person.id} canEdit={canEdit} mobile={person.role === 'mobile'} />
          <UnregisterPanel person={person} canEdit={canEdit} onChanged={reload} />
          {person.publishedSection ? (
            <p className="text-sm font-bold text-[#1a1020]">
              <a className="text-[#2b062f] underline" href={`/admin/signups/${person.id}/palnomoshtno.pdf`}>
                Свали пълномощното
              </a>
              {person.designationNumber ? ` · № ${person.designationNumber}` : ''}
            </p>
          ) : null}
          <form
            className="grid gap-4 rounded-2xl border-2 border-[#2b062f] bg-white p-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!canEdit || busy) return
              setBusy(true)
              setSaved(false)
              setMessage('')
              void adminUpdatePerson({
                data: {
                  id: person.id,
                  firstName: form.firstName,
                  middleName: form.middleName,
                  lastName: form.lastName,
                  phone: form.phone,
                  role: form.role,
                  roundsFirst: form.roundsFirst,
                  roundsRunoff: form.roundsRunoff,
                  experience: form.experience,
                  called: form.called,
                  staffNote: form.staffNote,
                  radius: form.radius,
                  extraCityRegions: form.extraCityRegions,
                  distantRegionCodes: form.distantRegionCodes,
                  travelMunicipalities: form.travelMunicipalities,
                },
              })
                .then((result) => {
                  if (!result.ok) {
                    setMessage(result.message)
                    return
                  }
                  setPerson(result.person)
                  setChanges(result.changes)
                  setForm(formFrom(result.person))
                  setSaved(true)
                })
                .catch(() => setMessage('Промените не се записаха.'))
                .finally(() => setBusy(false))
            }}
          >
            <fieldset className="grid gap-4" disabled={!canEdit || busy}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Име" value={form.firstName} onChange={(firstName) => setForm({ ...form, firstName })} />
                <Field label="Презиме" value={form.middleName} onChange={(middleName) => setForm({ ...form, middleName })} />
                <Field label="Фамилия" value={form.lastName} onChange={(lastName) => setForm({ ...form, lastName })} />
              </div>
              <Field label="Телефон" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
              <fieldset className="grid gap-2">
                <legend className="text-sm font-bold text-[#1a1020]">Роля</legend>
                {(['section', 'mobile', 'video', ''] as const).map((role) => (
                  <label key={role || 'none'} className="flex min-h-11 items-center gap-3 text-sm text-[#1a1020]">
                    <input
                      type="radio"
                      name="role"
                      className="h-5 w-5"
                      checked={form.role === role}
                      onChange={() => setForm({ ...form, role })}
                    />
                    {roleLabel(role || null)}
                  </label>
                ))}
              </fieldset>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-bold text-[#1a1020]">Дни</legend>
                <label className="flex min-h-11 items-center gap-3 text-sm text-[#1a1020]">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={form.roundsFirst}
                    onChange={(event) => setForm({ ...form, roundsFirst: event.target.checked })}
                  />
                  25 октомври
                </label>
                <label className="flex min-h-11 items-center gap-3 text-sm text-[#1a1020]">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={form.roundsRunoff}
                    onChange={(event) => setForm({ ...form, roundsRunoff: event.target.checked })}
                  />
                  1 ноември, балотаж
                </label>
              </fieldset>
              <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="person-experience">
                Опит
                <select
                  id="person-experience"
                  className={field}
                  value={form.experience}
                  onChange={(event) => setForm({ ...form, experience: event.target.value as Experience | '' })}
                >
                  <option value="">Без избор</option>
                  {EXPERIENCE.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <StaffTravel
                place={person.home}
                radius={form.radius || null}
                extraCityRegions={form.extraCityRegions}
                distantRegionCodes={form.distantRegionCodes}
                travelMunicipalities={form.travelMunicipalities}
                onChange={(next: StaffTravelValue) => setForm({ ...form, ...next })}
              />
              <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-[#1a1020]" htmlFor="staff-called">
                <input
                  id="staff-called"
                  type="checkbox"
                  className="h-5 w-5"
                  checked={form.called}
                  onChange={(event) => setForm({ ...form, called: event.target.checked })}
                />
                Отбележи, че сме се обадили
              </label>
              {form.called && person.staffCalledAt ? <p className="text-sm text-[#333]">{calledLine(person.staffCalledAt, person.staffCalledBy)}</p> : null}
              <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="staff-note">
                Бележка от екипа
                <textarea
                  id="staff-note"
                  className={`${field} min-h-28 py-2`}
                  value={form.staffNote}
                  onChange={(event) => setForm({ ...form, staffNote: event.target.value })}
                />
              </label>
            </fieldset>
            {canEdit ? (
              <button type="submit" className="brand-button" disabled={busy}>
                {busy ? 'Записваме…' : 'Запази'}
              </button>
            ) : (
              <p className="text-sm text-[#333]">Този достъп е само за преглед.</p>
            )}
            {saved ? (
              <p className="text-sm font-bold text-[#145744]" role="status">
                Записахме промените.
              </p>
            ) : null}
            {message ? (
              <p className="text-sm font-bold text-[#8f1d1d]" role="alert">
                {message}
              </p>
            ) : null}
          </form>
          <section className="grid gap-2" aria-labelledby="person-history">
            <h2 id="person-history" className="text-lg font-black text-[#1a1020]">
              История
            </h2>
            {changes.length === 0 ? (
              <p className="text-sm text-[#333]">Няма записани промени по ролята, дните, пътуването, бележката, отписването или прегледи на ЕГН.</p>
            ) : (
              <ul className="grid gap-2 text-sm text-[#1a1020]">
                {changes.map((change) => (
                  <li key={change.id}>
                    <span className="font-bold">{formatAuditWhen(change.at)}</span>
                    {` · ${change.actor} · ${describeAudit(change.field, change.before, change.after)}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

function PersonFacts({
  person,
  canRevealEgn,
  onEgnRevealed,
}: {
  person: AdminPerson
  canRevealEgn: boolean
  onEgnRevealed: (audit: AuditLine | null) => void
}) {
  const where = [person.town, person.place].filter(Boolean).join(' · ')
  return (
    <dl className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] p-4 text-sm text-[#1a1020] sm:grid-cols-2">
      <Fact label="Имейл" value={person.email} />
      <Fact label="Потвърждение" value={person.emailConfirmed ? 'Имейлът е потвърден' : 'Имейлът не е потвърден'} />
      <div className="grid gap-1">
        <dt className="font-bold">ЕГН</dt>
        <dd>
          <EgnReveal personId={person.id} hasEgn={person.hasEgn} last4={person.egnLast4} canReveal={canRevealEgn} onRevealed={onEgnRevealed} />
        </dd>
      </div>
      <Fact label="Желано място (от записването)" value={where || 'Няма избрано място'} />
      <Fact label="Докъде" value={person.radiusLabel || 'Не е избрано докъде може да стигне.'} />
      <Fact label="Секция" value={sectionLine(person)} />
      {person.publishedSection ? <AssignedSectionAddress section={person.publishedSection} /> : null}
      {person.designationPdfUrl ? (
        <div className="grid gap-1">
          <dt className="font-bold">Пълномощно в Drive</dt>
          <dd>
            <a className="break-all font-bold text-[#2b062f] underline" href={person.designationPdfUrl} target="_blank" rel="noreferrer">
              {person.designationPdfUrl}
            </a>
          </dd>
        </div>
      ) : null}
      {person.notes ? <Fact label="Бележка от човека" value={person.notes} /> : null}
      {person.callRequestedAt ? (
        <Fact label="Поискано обаждане" value={person.callMessage || 'Иска разговор с екипа.'} />
      ) : null}
      {person.cantReachSection ? (
        <Fact label="Не може да стигне" value={`Секция ${person.cantReachSection}`} />
      ) : null}
    </dl>
  )
}

/** Address of the published section itself, by its code (not the place the person picked). */
function AssignedSectionAddress({ section }: { section: string }) {
  const [state, setState] = useState<{ section: string; text: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    void adminSectionPlaces({ data: { codes: [section] } })
      .then((result) => {
        if (cancelled) return
        const place = result.ok ? assignedPlaceFromSpot(section, result.places[section]) : null
        setState({ section, text: assignedSectionLine(place) || 'Адресът на секцията не е намерен.' })
      })
      .catch(() => {
        if (!cancelled) setState({ section, text: 'Адресът на секцията не е намерен.' })
      })
    return () => {
      cancelled = true
    }
  }, [section])
  const text = state?.section === section ? state.text : 'Зареждам адреса…'
  return <Fact label="Адрес на публикуваната секция" value={text} />
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="font-bold">{label}</dt>
      <dd className="whitespace-pre-wrap">{value}</dd>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = `person-${label}`
  return (
    <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor={id}>
      {label}
      <input id={id} className={field} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function formFrom(person: AdminPerson): PersonForm {
  return {
    firstName: person.firstName,
    middleName: person.middleName,
    lastName: person.lastName,
    phone: person.phone,
    role: person.role ?? '',
    roundsFirst: person.roundsFirst,
    roundsRunoff: person.roundsRunoff,
    experience: person.experience ?? '',
    called: Boolean(person.staffCalledAt),
    staffNote: person.staffNote,
    radius: person.radius ?? '',
    extraCityRegions: person.extraCityRegions,
    distantRegionCodes: person.distantRegionCodes,
    travelMunicipalities: person.travelMunicipalities,
  }
}

function personName(person: AdminPerson) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ')
}

function progressSentence(person: AdminPerson) {
  if (person.withdrawn) return 'Записването е отписано.'
  if (person.submitted) return 'Завършил записването.'
  return person.gap ? `Започнал е, но не е завършил. ${person.gap}` : 'Започнал е, но не е завършил.'
}

function progressClass(person: AdminPerson) {
  const progress = signupProgress(person)
  if (progress === 'finished') return 'bg-[#145744] text-white'
  if (progress === 'withdrawn') return 'bg-[#3a3140] text-white'
  return 'border border-[#2b062f] bg-[#f4e4b3] text-[#1a1020]'
}

function sectionLine(person: AdminPerson) {
  if (person.publishedSection) return `Публикувана ${person.publishedSection}`
  if (person.draftSection) return `Чернова ${person.draftSection}`
  return 'Няма секция'
}

function calledLine(at: string, by: string) {
  return `${calledText(at, by)}.`
}

function ReservedNotice({ codes }: { codes: string[] }) {
  const reserved = useReservedIndex()
  const hits = [...new Set(codes.filter(Boolean))].flatMap((code) => {
    const org = reservedOrgFor(code, reserved)
    return org ? [{ code, org }] : []
  })
  if (hits.length === 0) return null
  return (
    <div role="alert" className="grid gap-1 rounded-2xl border-2 border-[#5a1a1a] bg-[#fbeaea] p-3 text-sm text-[#1a1020]">
      {hits.map((hit) => (
        <p key={hit.code}>
          <ReservedBadge org={hit.org} conflict /> Секция {hit.code} е резервирана от {hit.org}. Пренасочи човека в „Секции“.
        </p>
      ))}
    </div>
  )
}

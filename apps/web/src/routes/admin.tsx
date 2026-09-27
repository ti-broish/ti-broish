import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { adminDraft, adminExport, adminImportPeople, adminImportTaken, adminInvite, adminPublish, adminResendImports, adminRoster, adminStaffRemove, adminStaffRole, claimStaffSession } from '../signup/admin'
import { useProfile } from '../signup/store'
import type { RosterFields } from '../signup/admin-csv'
import { STAFF_ROLES, staffRoleLabel, type StaffRole } from '../signup/staff'

export const Route = createFileRoute('/admin')({ component: AdminPage })

const views = [
  ['all', 'Всички'],
  ['assigned', 'Със секция'],
  ['unassigned', 'Без секция'],
  ['draft', 'Чернова'],
  ['abroad', 'Чужбина'],
] as const

const field = 'min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3'
const button = 'brand-button'
const ghost = 'flex min-h-11 items-center justify-center rounded-[20px] border border-[#ddd] bg-white px-4 text-sm font-bold'

interface Taken {
  section_code: string
  mir_code: string
  place: string
  organisation: string
  note: string
}

interface Member {
  email: string
  role: StaffRole
  invitedBy: string
}

interface Permissions {
  edit: boolean
  exportCampaign: boolean
  exportInternal: boolean
  publish: boolean
  invite: boolean
}

type Access = { kind: 'loading' } | { kind: 'closed'; message: string } | { kind: 'ready'; email: string; role: StaffRole; permissions: Permissions; staff: Member[] }

function AdminPage() {
  const [view, setView] = useState<(typeof views)[number][0] | 'mir'>('unassigned')
  const [mir, setMir] = useState('')
  const [access, setAccess] = useState<Access>({ kind: 'loading' })
  const [people, setPeople] = useState<RosterFields[]>([])
  const [taken, setTaken] = useState<Taken[]>([])
  const [total, setTotal] = useState(0)
  const [message, setMessage] = useState('')
  const [armed, setArmed] = useState(false)
  const [links, setLinks] = useState<{ email: string; link: string }[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<StaffRole>('editor')

  function load(nextView = view, nextMir = mir) {
    setArmed(false)
    void adminRoster({ data: { view: nextView, mir: nextMir } }).then((result) => {
      if (!result.ok) {
        setAccess({ kind: 'closed', message: result.message })
        setPeople([])
        setTaken([])
        return
      }
      setAccess({ kind: 'ready', email: result.email, role: result.role, permissions: result.permissions, staff: result.staff })
      setPeople(result.people)
      setTaken(result.taken)
      setTotal(result.total)
    }).catch(() => setAccess({ kind: 'closed', message: 'Списъкът не се зареди.' }))
  }

  useEffect(() => {
    load()
  }, [])

  async function upload(file: File | null, kind: 'taken' | 'people') {
    if (!file) return
    const csv = await file.text()
    if (kind === 'taken') {
      const result = await adminImportTaken({ data: { csv } })
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      const problems = result.errors.length ? ` ${result.errors.join(' ')}` : ''
      setMessage(`Записани са ${result.imported} заети секции.${problems}`)
    } else {
      const result = await adminImportPeople({ data: { csv } })
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setLinks(result.links)
      const problems = result.errors.length ? ` ${result.errors.join(' ')}` : ''
      setMessage(`Въведени са ${result.imported} души, пропуснати ${result.skipped}, писма ${result.mailed}.${problems}`)
    }
    load()
  }

  if (access.kind !== 'ready') {
    return (
      <div className="grid gap-4">
        <PageIntro title="Записани хора" lede="Достъпът е по покана за потвърден имейл." />
        <p>{access.kind === 'loading' ? 'Проверяваме достъпа…' : access.message}</p>
        {access.kind === 'closed' ? <StaffSignIn onDone={() => load()} /> : null}
      </div>
    )
  }

  const permissions = access.permissions

  return (
    <div className="grid gap-8">
      <PageIntro
        title="Записани хора"
        lede="Черновата се вижда само тук. След публикуване човекът я вижда в профила си. Масовото писмо за секциите е CSV към Brevo. Cloudflare праща само код за потвърждение и писмо към човек, въведен от екипа."
      />
      <TeamPanel
        access={access}
        inviteEmail={inviteEmail}
        inviteRole={inviteRole}
        onEmail={setInviteEmail}
        onRole={setInviteRole}
        onMessage={setMessage}
        onReload={() => load()}
      />
      <div className="flex flex-wrap gap-2">
        {views.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={view === id ? 'min-h-10 rounded-full bg-[#333] px-3 text-sm font-bold text-white' : ghost}
            onClick={() => {
              setView(id)
              load(id, mir)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setView('mir')
          load('mir', mir)
        }}
      >
        <label className="grid gap-1 text-sm font-semibold">
          МИР
          <input className="min-h-11 w-24 rounded-xl border border-[#ddd] bg-white px-3" inputMode="numeric" value={mir} onChange={(event) => setMir(event.target.value)} />
        </label>
        <button className={ghost} type="submit">
          Покажи МИР
        </button>
      </form>
      <p className="text-sm leading-6">
        {total} в този изглед{total > people.length ? `. На екрана са първите ${people.length}.` : ''}. CSV за Brevo няма чернова и няма ЕГН. Вътрешното CSV пази черновата и последните 4 цифри на ЕГН.
      </p>
      <div className="flex flex-wrap gap-2">
        {permissions.exportCampaign ? (
          <button
            type="button"
            className={ghost}
            onClick={() => {
              void adminExport({ data: { view, mir, kind: 'campaign' } }).then((result) => {
                if (!result.ok) setMessage(result.message)
                else download(result.filename, result.csv)
              })
            }}
          >
            CSV за Brevo
          </button>
        ) : null}
        {permissions.exportInternal ? (
          <button
            type="button"
            className={ghost}
            onClick={() => {
              void adminExport({ data: { view, mir, kind: 'internal' } }).then((result) => {
                if (!result.ok) setMessage(result.message)
                else download(result.filename, result.csv)
              })
            }}
          >
            CSV за екипа
          </button>
        ) : null}
        {permissions.publish ? (
          <button
            type="button"
            className={armed ? button : ghost}
            onClick={() => {
              if (!armed) {
                setArmed(true)
                return
              }
              void adminPublish({ data: { view, mir } }).then((result) => {
                setArmed(false)
                if (!result.ok) setMessage(result.message)
                else {
                  setMessage(`Публикувани са ${result.published} чернови. Писмото към тях се праща от Brevo.`)
                  load()
                }
              })
            }}
          >
            {armed ? 'Да, покажи ги в профилите' : 'Публикувай черновите в този изглед'}
          </button>
        ) : null}
      </div>
      {message ? <p className="text-sm leading-6">{message}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#ddd] text-[#666]">
              <th className="py-2 pr-3 font-bold">Човек</th>
              <th className="py-2 pr-3 font-bold">МИР</th>
              <th className="py-2 pr-3 font-bold">Място</th>
              <th className="py-2 pr-3 font-bold">Чернова</th>
              <th className="py-2 font-bold">Публикувана</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id} className="border-b border-[#eee] align-top">
                <td className="py-3 pr-3">
                  <p className="font-bold">
                    {person.firstName} {person.lastName}
                  </p>
                  <p>{person.email}</p>
                  <p className="text-[#666]">{person.phone}</p>
                  <p className="text-[#666]">{statusLabel(person)}</p>
                </td>
                <td className="py-3 pr-3">{person.mir || (person.region === '32' ? 'чужбина' : person.region)}</td>
                <td className="py-3 pr-3">{person.place}</td>
                <td className="py-3 pr-3">
                  {permissions.edit ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        const section = String(new FormData(event.currentTarget).get('section') ?? '')
                        void adminDraft({ data: { id: person.id, section } }).then((result) => {
                          if (!result.ok) setMessage(result.message)
                          else {
                            setMessage(result.warning || 'Черновата е запазена и не се вижда от човека.')
                            load()
                          }
                        })
                      }}
                    >
                      <input name="section" className="min-h-10 w-32 rounded-xl border border-[#ddd] px-2" defaultValue={person.draftSection} aria-label={`Чернова за ${person.email}`} />
                      <button className="text-sm font-bold" type="submit">
                        Запази
                      </button>
                    </form>
                  ) : (
                    person.draftSection
                  )}
                </td>
                <td className="py-3">{person.publishedSection}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {people.length === 0 ? <p className="mt-4">Няма хора в този изглед.</p> : null}
      </div>
      {permissions.edit ? (
      <>
      <section className="grid gap-3 border-t border-[#ddd] pt-6">
        <h2 className="text-xl font-black text-[#444]">Заети секции</h2>
        <p className="leading-7">Секции, взети от друга организация или друг процес. Колони: секция, организация, място, мир, бележка.</p>
        <input
          className={field}
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV със заети секции"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null
            event.target.value = ''
            void upload(file, 'taken')
          }}
        />
        <ul className="grid gap-2 text-sm">
          {taken.map((row) => (
            <li key={row.section_code}>
              {row.section_code} · {row.organisation}
              {row.place ? ` · ${row.place}` : ''}
              {row.mir_code ? ` · МИР ${row.mir_code}` : ''}
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-3 border-t border-[#ddd] pt-6">
        <h2 className="text-xl font-black text-[#444]">Хора, въведени от екипа</h2>
        <p className="leading-7">Колони: име, презиме, фамилия, имейл, телефон. Получават писмо да потвърдят или да променят данните. До 500 реда на файл.</p>
        <input
          className={field}
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV с хора"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null
            event.target.value = ''
            void upload(file, 'people')
          }}
        />
        <button
          type="button"
          className={ghost}
          onClick={() => {
            void adminResendImports({ data: { limit: 100 } }).then((result) => {
              if (!result.ok) setMessage(result.message)
              else {
                setLinks(result.links)
                setMessage(`Писма: ${result.mailed} от ${result.pending}. Останалите линкове са под списъка, ако домейнът още не праща.`)
              }
            })
          }}
        >
          Изпрати чакащите писма
        </button>
        {links.length > 0 ? (
          <ul className="grid gap-2 text-sm">
            {links.map((item) => (
              <li key={item.email}>
                {item.email} · <a href={item.link}>{item.link}</a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      </>
      ) : null}
    </div>
  )
}

function StaffSignIn({ onDone }: { onDone: () => void }) {
  const { profile, ready } = useProfile()
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (ready && profile.email) setEmail(profile.email)
  }, [ready, profile.email])
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void claimStaffSession({ data: { email } }).then((result) => {
          if (!result.ok) {
            setNote(result.message)
            return
          }
          onDone()
        })
      }}
    >
      <p>Профилът в браузъра не отваря списъка. Влез с потвърдения имейл, който е в екипа.</p>
      <label className="grid gap-1 text-sm font-semibold">
        Имейл
        <input className={field} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      {note ? <p className="text-sm text-red-700">{note}</p> : null}
      <button className={button} type="submit">
        Влез в списъка
      </button>
    </form>
  )
}

function TeamPanel({
  access,
  inviteEmail,
  inviteRole,
  onEmail,
  onRole,
  onMessage,
  onReload,
}: {
  access: Extract<Access, { kind: 'ready' }>
  inviteEmail: string
  inviteRole: StaffRole
  onEmail: (value: string) => void
  onRole: (value: StaffRole) => void
  onMessage: (value: string) => void
  onReload: () => void
}) {
  return (
    <section className="grid gap-3 border-b border-[#ddd] pb-6">
      <h2 className="text-xl font-black text-[#444]">Екип</h2>
      <p>
        Влязъл си като {access.email}. Роля: {staffRoleLabel(access.role)}.
      </p>
      <ul className="grid gap-2">
        {access.staff.map((member) => (
          <li key={member.email} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">{member.email}</span>
            {access.permissions.invite ? (
              <>
                <select
                  className="min-h-10 rounded-xl border border-[#ddd] bg-white px-2"
                  value={member.role}
                  aria-label={`Роля на ${member.email}`}
                  onChange={(event) => {
                    const role = event.target.value as StaffRole
                    void adminStaffRole({ data: { email: member.email, role } }).then((result) => {
                      onMessage(result.message)
                      if (result.ok) onReload()
                    })
                  }}
                >
                  {STAFF_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {staffRoleLabel(role)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="font-bold"
                  onClick={() => {
                    void adminStaffRemove({ data: { email: member.email } }).then((result) => {
                      onMessage(result.message)
                      if (result.ok) onReload()
                    })
                  }}
                >
                  Махни
                </button>
              </>
            ) : (
              <span>{staffRoleLabel(member.role)}</span>
            )}
          </li>
        ))}
      </ul>
      {access.permissions.invite ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void adminInvite({ data: { email: inviteEmail, role: inviteRole } }).then((result) => {
              onMessage(result.message)
              if (result.ok) {
                onEmail('')
                onReload()
              }
            })
          }}
        >
          <label className="grid gap-1 text-sm font-semibold">
            Имейл
            <input className="min-h-11 w-64 rounded-xl border border-[#ddd] bg-white px-3" type="email" value={inviteEmail} onChange={(event) => onEmail(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Роля
            <select className="min-h-11 rounded-xl border border-[#ddd] bg-white px-2" value={inviteRole} onChange={(event) => onRole(event.target.value as StaffRole)}>
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {staffRoleLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <button className="brand-button" type="submit">
            Покани
          </button>
        </form>
      ) : null}
    </section>
  )
}

function statusLabel(person: RosterFields) {
  if (person.withdrawn) return 'оттеглен'
  if (person.imported && !person.emailConfirmed) return 'чака потвърждение'
  if (!person.emailConfirmed) return 'имейлът не е потвърден'
  if (person.publishedSection) return 'публикувана секция'
  if (person.draftSection) return 'чернова'
  return person.submitted ? 'без секция' : 'недовършен'
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

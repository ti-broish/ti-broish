import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageIntro } from '../../components/SiteChrome'
import { adminInvite, adminRoster, adminStaffRemove, adminStaffRole } from '../../signup/admin'
import { STAFF_ROLES, staffRoleLabel, type StaffRole } from '../../signup/staff'

export const Route = createFileRoute('/admin/access')({
  component: AccessPage,
})

function AccessPage() {
  const [staff, setStaff] = useState<Array<{ email: string; role: StaffRole }>>([])
  const [canInvite, setCanInvite] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('editor')
  const [message, setMessage] = useState('')

  function load() {
    void adminRoster({ data: { view: 'all', mir: '' } }).then((result) => {
      if (!result.ok) return
      setStaff(result.staff)
      setCanInvite(result.permissions.invite)
    })
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="grid gap-4">
      <PageIntro title="Достъп" lede="Кой влиза в админа и с каква роля. Преглед само гледа. Редактор пише чернови. Админ публикува и кани." />
      {message ? <p>{message}</p> : null}
      <ul className="grid gap-2">
        {staff.map((member) => (
          <li key={member.email} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">{member.email}</span>
            {canInvite ? (
              <>
                <select
                  className="min-h-10 rounded-xl border border-[#ddd] bg-white px-2"
                  value={member.role}
                  aria-label={`Роля на ${member.email}`}
                  onChange={(event) => {
                    const next = event.target.value as StaffRole
                    void adminStaffRole({ data: { email: member.email, role: next } }).then((result) => {
                      setMessage(result.message)
                      if (result.ok) load()
                    })
                  }}
                >
                  {STAFF_ROLES.map((item) => (
                    <option key={item} value={item}>
                      {staffRoleLabel(item)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="font-bold"
                  onClick={() => {
                    void adminStaffRemove({ data: { email: member.email } }).then((result) => {
                      setMessage(result.message)
                      if (result.ok) load()
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
      {canInvite ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void adminInvite({ data: { email, role } }).then((result) => {
              setMessage(result.message)
              if (result.ok) {
                setEmail('')
                load()
              }
            })
          }}
        >
          <label className="grid gap-1 text-sm font-semibold">
            Имейл
            <input className="min-h-11 w-64 rounded-xl border border-[#ddd] bg-white px-3" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Роля
            <select className="min-h-11 rounded-xl border border-[#ddd] bg-white px-2" value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
              {STAFF_ROLES.map((item) => (
                <option key={item} value={item}>
                  {staffRoleLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <button className="brand-button" type="submit">
            Покани
          </button>
        </form>
      ) : null}
    </div>
  )
}

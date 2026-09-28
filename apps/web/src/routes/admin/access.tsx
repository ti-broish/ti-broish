import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { AdminHeading, adminGhost, adminInput } from '../../components/admin-ui'
import { adminInvite, adminStaffRemove, adminStaffRole } from '../../signup/admin'
import { STAFF_ROLES, staffRoleLabel, type StaffRole } from '../../signup/staff'

export const Route = createFileRoute('/admin/access')({
  component: AccessPage,
})

function AccessPage() {
  const access = useAdminAccess()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('editor')
  const [message, setMessage] = useState('')
  const canInvite = access.permissions.invite

  return (
    <div className="grid max-w-3xl gap-5">
      <AdminHeading title="Достъп" lede="Кой влиза в админа и с каква роля. Преглед само гледа. Редактор пише чернови. Админ публикува и кани." />
      {message ? <p className="text-sm font-bold text-[#1a1020]">{message}</p> : null}
      <ul className="grid gap-2">
        {access.staff.map((member) => (
          <li key={member.email} className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-[#2b062f] bg-white px-3 py-2 text-sm text-[#1a1020]">
            <span className="min-w-0 flex-1 break-all font-bold">{member.email}</span>
            {canInvite ? (
              <>
                <select
                  className={`${adminInput} min-w-36`}
                  value={member.role}
                  aria-label={`Роля на ${member.email}`}
                  onChange={(event) => {
                    const next = event.target.value as StaffRole
                    void adminStaffRole({ data: { email: member.email, role: next } }).then((result) => {
                      setMessage(result.message)
                      if (result.ok) access.reload()
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
                  className={adminGhost}
                  onClick={() => {
                    void adminStaffRemove({ data: { email: member.email } }).then((result) => {
                      setMessage(result.message)
                      if (result.ok) access.reload()
                    })
                  }}
                >
                  Махни
                </button>
              </>
            ) : (
              <span className="font-bold">{staffRoleLabel(member.role)}</span>
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
                access.reload()
              }
            })
          }}
        >
          <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="invite-email">
            Имейл
            <input id="invite-email" className={`${adminInput} w-64 max-w-full`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="invite-role">
            Роля
            <select id="invite-role" className={adminInput} value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
              {STAFF_ROLES.map((item) => (
                <option key={item} value={item}>
                  {staffRoleLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <button className="brand-button w-auto px-6" type="submit">
            Покани
          </button>
        </form>
      ) : (
        <p className="text-sm text-[#333]">Тази роля вижда екипа, без да кани.</p>
      )}
    </div>
  )
}

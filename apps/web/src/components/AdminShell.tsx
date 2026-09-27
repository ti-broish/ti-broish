import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageIntro } from './SiteChrome'
import { adminRoster } from '../signup/admin'
import { staffRoleLabel, type StaffRole } from '../signup/staff'

export interface AdminPermissions {
  edit: boolean
  exportCampaign: boolean
  exportInternal: boolean
  publish: boolean
  invite: boolean
}

export interface AdminMember {
  email: string
  role: StaffRole
  invitedBy: string
}

export type AdminAccess =
  | { kind: 'loading' }
  | { kind: 'closed'; message: string }
  | { kind: 'ready'; email: string; role: StaffRole; permissions: AdminPermissions; staff: AdminMember[] }

const links = [
  { to: '/admin', label: 'Начало' },
  { to: '/admin/access', label: 'Достъп' },
  { to: '/admin/signups', label: 'Записвания' },
  { to: '/admin/sections', label: 'Секции' },
] as const

export function AdminShell() {
  const [access, setAccess] = useState<AdminAccess>({ kind: 'loading' })
  const path = useRouterState({ select: (state) => state.location.pathname })

  useEffect(() => {
    void adminRoster({ data: { view: 'all', mir: '' } }).then((result) => {
      if (!result.ok) {
        setAccess({ kind: 'closed', message: result.message })
        return
      }
      setAccess({ kind: 'ready', email: result.email, role: result.role, permissions: result.permissions, staff: result.staff })
    }).catch(() => setAccess({ kind: 'closed', message: 'Списъкът не се зареди.' }))
  }, [])

  if (access.kind !== 'ready') {
    return (
      <div className="grid gap-4">
        <PageIntro title="Админ" lede="Достъпът е по покана за потвърден имейл." />
        <p>{access.kind === 'loading' ? 'Проверяваме достъпа…' : access.message}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-8">
      <p className="text-sm">
        {access.email} · {staffRoleLabel(access.role)}
      </p>
      <nav className="flex flex-wrap gap-2" aria-label="Админ">
        {links.map((item) => {
          const on = path === item.to
          return (
            <Link
              key={item.to}
              to={item.to}
              className={on ? 'min-h-10 rounded-full bg-[#333] px-3 text-sm font-bold leading-10 text-white' : 'min-h-10 rounded-full border border-[#ddd] bg-white px-3 text-sm font-bold leading-10'}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
      <Outlet />
    </div>
  )
}

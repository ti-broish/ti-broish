import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { createContext, useContext, useEffect, useState } from 'react'
import { PageIntro } from './SiteChrome'
import { adminInput } from './admin-ui'
import { defaultSectionSearch, defaultSignupSearch } from '../signup/admin-search'
import { adminSession, claimStaffSession, type AdminSummary } from '../signup/admin'
import { useProfile } from '../signup/store'
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

export type AdminReady = {
  kind: 'ready'
  email: string
  role: StaffRole
  permissions: AdminPermissions
  staff: AdminMember[]
  summary: AdminSummary
  reload: () => void
}

export type AdminAccess = { kind: 'loading' } | { kind: 'closed'; message: string } | AdminReady

const AdminAccessContext = createContext<AdminAccess>({ kind: 'loading' })

export function useAdminAccess() {
  const access = useContext(AdminAccessContext)
  if (access.kind !== 'ready') throw new Error('Админът още не е отворен.')
  return access
}

const links = [
  { to: '/admin', label: 'Начало', exact: true },
  { to: '/admin/signups', label: 'Записвания', exact: false },
  { to: '/admin/sections', label: 'Секции', exact: false },
  { to: '/admin/access', label: 'Достъп', exact: false },
] as const

const field = `${adminInput} w-full`
const button = 'brand-button'

function loadAccess(setAccess: (access: AdminAccess) => void) {
  setAccess({ kind: 'loading' })
  const reload = () => loadAccess(setAccess)
  void adminSession()
    .then((result) => {
      if (!result.ok) {
        setAccess({ kind: 'closed', message: result.message })
        return
      }
      setAccess({
        kind: 'ready',
        email: result.email,
        role: result.role,
        permissions: result.permissions,
        staff: result.staff,
        summary: result.summary,
        reload,
      })
    })
    .catch(() => setAccess({ kind: 'closed', message: 'Списъкът не се зареди.' }))
}

export function AdminShell() {
  const [access, setAccess] = useState<AdminAccess>({ kind: 'loading' })
  const [menuOpen, setMenuOpen] = useState(false)
  const path = useRouterState({ select: (state) => state.location.pathname })

  useEffect(() => {
    loadAccess(setAccess)
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [path])

  if (access.kind !== 'ready') {
    return (
      <div className="mx-auto grid max-w-lg gap-4 px-4 py-8 text-[#1a1020]">
        <PageIntro title="Админ" lede="Достъпът е по покана за потвърден имейл." />
        <p className="text-[#1a1020]">{access.kind === 'loading' ? 'Проверяваме достъпа…' : access.message}</p>
        {access.kind === 'closed' ? <StaffSignIn onDone={() => loadAccess(setAccess)} /> : null}
      </div>
    )
  }

  return (
    <AdminAccessContext.Provider value={access}>
      <div className="min-h-[calc(100vh-60px)] bg-white text-[#1a1020] md:grid md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="sticky top-[60px] hidden h-[calc(100vh-60px)] flex-col border-r-2 border-[#2b062f] bg-[#f6f1f7] md:flex">
          <SidebarBrand />
          <SidebarNav path={path} />
          <StaffFoot email={access.email} role={access.role} />
        </aside>
        <div className="min-w-0">
          <div className="flex items-center gap-3 border-b-2 border-[#2b062f] bg-[#f6f1f7] px-4 py-3 md:hidden">
            <button
              type="button"
              className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl border-2 border-[#2b062f] bg-white px-3 text-sm font-bold text-[#1a1020]"
              aria-label={menuOpen ? 'Затвори админ менюто' : 'Админ меню'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              Меню
            </button>
            <p className="text-lg font-black text-[#2b062f]">Админ</p>
          </div>
          {menuOpen ? (
            <div className="fixed inset-x-0 bottom-0 top-[60px] z-30 overflow-auto bg-[#2b062f] p-4 md:hidden">
              <nav aria-label="Админ меню" className="admin-drawer grid gap-2">
                {links.map((item) => {
                  const on = item.exact ? path === item.to : path.startsWith(item.to)
                  return (
                    <AdminLink
                      key={item.to}
                      to={item.to}
                      active={on}
                      className={
                        on
                          ? 'flex min-h-11 items-center rounded-xl bg-white px-3 text-lg font-bold'
                          : 'flex min-h-11 items-center rounded-xl px-3 text-lg font-bold'
                      }
                      onClick={() => setMenuOpen(false)}
                    >
                      {item.label}
                    </AdminLink>
                  )
                })}
              </nav>
              <p className="mt-6 text-sm font-bold text-white">
                {access.email}
                <span className="mt-1 block font-medium text-[#f6f1f7]">{staffRoleLabel(access.role)}</span>
              </p>
            </div>
          ) : null}
          <div className="px-4 py-6 md:px-8">
            <Outlet />
          </div>
        </div>
      </div>
    </AdminAccessContext.Provider>
  )
}

function SidebarBrand() {
  return (
    <div className="flex items-center gap-2 px-4 pt-4">
      <img src="/logo.png" alt="" className="h-8 w-8 object-contain" />
      <span className="text-lg font-black tracking-tight text-[#2b062f]">Админ</span>
    </div>
  )
}

function SidebarNav({ path }: { path: string }) {
  return (
    <nav aria-label="Админ" className="admin-nav grid gap-1 p-3">
      {links.map((item) => {
        const on = item.exact ? path === item.to : path.startsWith(item.to)
        return (
          <AdminLink
            key={item.to}
            to={item.to}
            active={on}
            className={
              on
                ? 'flex min-h-11 items-center rounded-xl bg-[#2b062f] px-3 text-sm font-bold'
                : 'flex min-h-11 items-center rounded-xl px-3 text-sm font-bold hover:bg-[#e7dce9]'
            }
          >
            {item.label}
          </AdminLink>
        )
      })}
    </nav>
  )
}

function StaffFoot({ email, role }: { email: string; role: StaffRole }) {
  return (
    <div className="mt-auto border-t-2 border-[#2b062f] p-4">
      <p className="break-all text-sm font-bold text-[#1a1020]">{email}</p>
      <p className="text-sm text-[#333]">{staffRoleLabel(role)}</p>
    </div>
  )
}

function AdminLink({
  to,
  className,
  active,
  onClick,
  children,
}: {
  to: (typeof links)[number]['to']
  className: string
  active: boolean
  onClick?: () => void
  children: string
}) {
  const current = active ? 'page' : undefined
  if (to === '/admin/signups') {
    return (
      <Link to={to} search={defaultSignupSearch} className={className} aria-current={current} onClick={onClick}>
        {children}
      </Link>
    )
  }
  if (to === '/admin/sections') {
    return (
      <Link to={to} search={defaultSectionSearch} className={className} aria-current={current} onClick={onClick}>
        {children}
      </Link>
    )
  }
  return (
    <Link to={to} className={className} aria-current={current} onClick={onClick}>
      {children}
    </Link>
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
      <p className="text-[#1a1020]">Профилът в браузъра не отваря списъка. Влез с потвърдения имейл, който е в екипа.</p>
      <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="staff-email">
        Имейл
        <input id="staff-email" className={field} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      {note ? <p className="text-sm font-bold text-[#8f1d1d]">{note}</p> : null}
      <button className={button} type="submit">
        Влез в списъка
      </button>
    </form>
  )
}

import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { PageIntro } from './SiteChrome'
import { adminInput } from './admin-ui'
import { defaultQueueSearch, defaultSectionSearch, defaultSignupSearch } from '../signup/admin-search'
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
  { to: '/admin/calls', label: 'Обаждания', exact: false },
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
      <div className="min-h-[calc(100vh-60px)] bg-white text-[#1a1020] md:grid md:grid-cols-[4.5rem_minmax(0,1fr)]">
        <div className="sticky top-[60px] z-30 hidden h-[calc(100vh-60px)] md:block">
          <aside className="group absolute inset-y-0 left-0 flex w-[4.5rem] flex-col overflow-hidden border-r-2 border-[#2b062f] bg-[#f6f1f7] transition-[width] duration-150 ease-out hover:w-[13rem] hover:shadow-[4px_0_24px_rgba(43,6,47,0.18)] focus-within:w-[13rem] focus-within:shadow-[4px_0_24px_rgba(43,6,47,0.18)]">
            <SidebarBrand />
            <SidebarNav path={path} />
            <StaffFoot email={access.email} role={access.role} />
          </aside>
        </div>
        <div className="relative z-0 min-w-0">
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
    <div className="px-2 pt-3">
      <img
        src="/icons/icon-192.png"
        alt="Ти Броиш"
        className="mx-auto block h-14 w-14 rounded-xl object-contain group-hover:hidden group-focus-within:hidden"
      />
      <img
        src="/logo.png"
        alt=""
        className="hidden h-12 w-full object-contain object-left group-hover:block group-focus-within:block"
      />
      <span className="mt-2 hidden text-sm font-black tracking-tight text-[#2b062f] group-hover:block group-focus-within:block">Админ</span>
    </div>
  )
}

function SidebarNav({ path }: { path: string }) {
  return (
    <nav aria-label="Админ" className="admin-nav grid gap-1 p-1 group-hover:p-2 group-focus-within:p-2">
      {links.map((item) => {
        const on = item.exact ? path === item.to : path.startsWith(item.to)
        return (
          <AdminLink
            key={item.to}
            to={item.to}
            active={on}
            label={item.label}
            className={
              on
                ? 'flex min-h-11 items-center justify-center rounded-xl bg-[#2b062f] px-0 text-sm font-bold group-hover:justify-start group-hover:px-3 group-focus-within:justify-start group-focus-within:px-3'
                : 'flex min-h-11 items-center justify-center rounded-xl px-0 text-sm font-bold hover:bg-[#e7dce9] group-hover:justify-start group-hover:px-3 group-focus-within:justify-start group-focus-within:px-3'
            }
          >
            <span className="group-hover:hidden group-focus-within:hidden">{item.label.slice(0, 1)}</span>
            <span className="hidden group-hover:inline group-focus-within:inline">{item.label}</span>
          </AdminLink>
        )
      })}
    </nav>
  )
}

function StaffFoot({ email, role }: { email: string; role: StaffRole }) {
  return (
    <div className="mt-auto border-t-2 border-[#2b062f] p-2 group-hover:p-3 group-focus-within:p-3">
      <p className="text-center text-sm font-black text-[#1a1020] group-hover:hidden group-focus-within:hidden" title={email}>
        {email.slice(0, 1).toUpperCase()}
      </p>
      <div className="hidden group-hover:block group-focus-within:block">
        <p className="break-all text-sm font-bold text-[#1a1020]">{email}</p>
        <p className="text-sm text-[#333]">{staffRoleLabel(role)}</p>
      </div>
    </div>
  )
}

function AdminLink({
  to,
  className,
  active,
  label,
  onClick,
  children,
}: {
  to: (typeof links)[number]['to']
  className: string
  active: boolean
  label?: string
  onClick?: () => void
  children: ReactNode
}) {
  const current = active ? 'page' : undefined
  const name = label ?? (typeof children === 'string' ? children : undefined)
  if (to === '/admin/signups') {
    return (
      <Link to={to} search={defaultSignupSearch} className={className} aria-current={current} aria-label={name} onClick={onClick}>
        {children}
      </Link>
    )
  }
  if (to === '/admin/calls') {
    return (
      <Link to={to} search={defaultQueueSearch} className={className} aria-current={current} aria-label={name} onClick={onClick}>
        {children}
      </Link>
    )
  }
  if (to === '/admin/sections') {
    return (
      <Link to={to} search={defaultSectionSearch} className={className} aria-current={current} aria-label={name} onClick={onClick}>
        {children}
      </Link>
    )
  }
  return (
    <Link to={to} className={className} aria-current={current} aria-label={name} onClick={onClick}>
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
      <p className="text-[#1a1020]">Профилът на това устройство не отваря списъка. Влез с имейла, с който си в екипа.</p>
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

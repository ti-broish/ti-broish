import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { createContext, useContext, useEffect, useState } from 'react'
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

const NAV_KEY = 'tb-admin-nav'

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
  const [collapsed, setCollapsed] = useState(true)
  const path = useRouterState({ select: (state) => state.location.pathname })

  useEffect(() => {
    loadAccess(setAccess)
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [path])

  useEffect(() => {
    try {
      if (sessionStorage.getItem(NAV_KEY) === 'open') setCollapsed(false)
    } catch {
      /* The rail stays collapsed when storage is blocked. */
    }
  }, [])

  function toggleNav() {
    setCollapsed((current) => {
      const next = !current
      try {
        sessionStorage.setItem(NAV_KEY, next ? 'closed' : 'open')
      } catch {
        /* The choice still applies for this visit. */
      }
      return next
    })
  }

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
      <div className={`min-h-[calc(100vh-60px)] bg-white text-[#1a1020] md:grid ${collapsed ? 'md:grid-cols-[4.5rem_minmax(0,1fr)]' : 'md:grid-cols-[13rem_minmax(0,1fr)]'}`}>
        <aside className="sticky top-[60px] hidden h-[calc(100vh-60px)] min-w-0 flex-col border-r-2 border-[#2b062f] bg-[#f6f1f7] md:flex">
          <SidebarBrand collapsed={collapsed} onToggle={toggleNav} />
          <SidebarNav path={path} collapsed={collapsed} />
          <StaffFoot email={access.email} role={access.role} collapsed={collapsed} />
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

function SidebarBrand({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <div className={collapsed ? 'grid justify-items-center gap-2 px-1 pt-3' : 'grid gap-2 px-2 pt-3'}>
      <img
        src="/logo.png"
        alt="Ти Броиш"
        className={collapsed ? 'h-14 w-14 object-cover object-left' : 'h-12 w-full object-contain object-left'}
      />
      {collapsed ? null : <span className="text-sm font-black tracking-tight text-[#2b062f]">Админ</span>}
      <button
        type="button"
        className="inline-flex h-11 w-full items-center justify-center rounded-xl border-2 border-[#2b062f] bg-white text-sm font-bold text-[#1a1020]"
        aria-label={collapsed ? 'Разгъни менюто' : 'Свий менюто'}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? '»' : '«'}
      </button>
    </div>
  )
}

function SidebarNav({ path, collapsed }: { path: string; collapsed: boolean }) {
  return (
    <nav aria-label="Админ" className={collapsed ? 'admin-nav grid gap-1 p-1' : 'admin-nav grid gap-1 p-2'}>
      {links.map((item) => {
        const on = item.exact ? path === item.to : path.startsWith(item.to)
        const pad = collapsed ? 'justify-center px-0' : 'px-3'
        return (
          <AdminLink
            key={item.to}
            to={item.to}
            active={on}
            label={item.label}
            className={
              on
                ? `flex min-h-11 items-center rounded-xl bg-[#2b062f] text-sm font-bold ${pad}`
                : `flex min-h-11 items-center rounded-xl text-sm font-bold hover:bg-[#e7dce9] ${pad}`
            }
          >
            {collapsed ? item.label.slice(0, 1) : item.label}
          </AdminLink>
        )
      })}
    </nav>
  )
}

function StaffFoot({ email, role, collapsed }: { email: string; role: StaffRole; collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="mt-auto border-t-2 border-[#2b062f] p-2 text-center">
        <p className="text-sm font-black text-[#1a1020]" title={email}>
          {email.slice(0, 1).toUpperCase()}
        </p>
      </div>
    )
  }
  return (
    <div className="mt-auto border-t-2 border-[#2b062f] p-3">
      <p className="break-all text-sm font-bold text-[#1a1020]">{email}</p>
      <p className="text-sm text-[#333]">{staffRoleLabel(role)}</p>
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
  children: string
}) {
  const current = active ? 'page' : undefined
  const name = label ?? children
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

import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { isProtocolDay } from '../signup/election'
import { useRegistration } from '../signup/use-registration'

const links = [
  { to: '/about', label: 'Кампанията' },
  { to: '/posts', label: 'Актуално' },
  { to: '/instructions', label: 'Инструкции' },
  { to: '/signal', label: 'Подай сигнал' },
  { to: '/profil', label: 'Профил' },
] as const

function searchFromHref(href: string) {
  const queryAt = href.indexOf('?')
  if (queryAt === -1) return ''
  const hashAt = href.indexOf('#', queryAt)
  return href.slice(queryAt, hashAt === -1 ? undefined : hashAt)
}

function pageFrameClass(path: string, search: string) {
  if (path.startsWith('/admin')) return 'w-full max-w-none bg-white px-0 py-0'
  const step = new URLSearchParams(search).get('step')
  const wideMap = path === '/signup' && (step === 'place' || step === 'travel' || step === 'radius')
  const wideProfile = path === '/profil'
  if (wideMap || wideProfile) return 'mx-auto w-full max-w-6xl bg-white px-4 py-8'
  return 'mx-auto w-full max-w-lg bg-white px-4 py-8'
}

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const path = useRouterState({ select: (state) => state.location.pathname })
  const search = useRouterState({ select: (state) => searchFromHref(state.location.href) })
  const { settled, pending } = useRegistration()
  useEffect(() => {
    setOpen(false)
  }, [path])
  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js')
  }, [])

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/">
            <img src="/logo-white.png" alt="Ти Броиш" />
          </Link>
          <nav className="site-nav">
            {links.map((link) => (
              <Link key={link.to} to={link.to}>
                {link.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            className={open ? 'nav-burger is-open' : 'nav-burger'}
            aria-label={open ? 'Затвори менюто' : 'Меню'}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>
      {open ? (
        <nav className="mobile-menu" aria-label="Меню">
          {links.map((link) => (
            <Link key={link.to} to={link.to} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <main className={pageFrameClass(path, search)}>{children}</main>
      {path.startsWith('/admin') ? null : <div className="h-10 bg-[#2b062f]" />}
      {path.startsWith('/admin') ? null : (
      <footer className="bg-[#eee] text-[#333]">
        <nav className="mx-auto flex max-w-lg flex-wrap gap-x-4 gap-y-2 px-4 py-6">
          <Link to="/kontakt" className="font-bold text-[#333] no-underline">
            Контакт
          </Link>
          {settled ? (
            <Link to="/profil" className="font-bold text-[#333] no-underline">
              Профилът ти
            </Link>
          ) : pending ? null : (
            <Link to="/signup" search={{ step: 'contact' }} className="font-bold text-[#333] no-underline">
              Запиши се
            </Link>
          )}
          <Link to="/signal" className="font-bold text-[#333] no-underline">
            Подай сигнал
          </Link>
          {isProtocolDay() ? (
            <Link to="/protokol" className="font-bold text-[#333] no-underline">
              Изпрати протокол
            </Link>
          ) : null}
          <Link to="/privacy-notice" className="font-bold text-[#333] no-underline">
            Поверителност
          </Link>
          <a className="font-bold text-[#333]" href="https://www.facebook.com/tibroish/" target="_blank" rel="noopener noreferrer">
            Facebook
          </a>
          <a className="font-bold text-[#333]" href="https://www.instagram.com/tibroish.bg/" target="_blank" rel="noopener noreferrer">
            Instagram
          </a>
          <a className="font-bold text-[#333]" href="https://www.tiktok.com/@tibroish" target="_blank" rel="noopener noreferrer">
            TikTok
          </a>
        </nav>
        <p className="bg-[#666] py-4 text-center font-bold text-white">Ти Броиш © {new Date().getFullYear()}</p>
      </footer>
      )}
    </>
  )
}

export function PageIntro({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-3xl font-black text-[#444]">{title}</h1>
      {lede ? <p className="mt-3 text-lg leading-7 text-[#333]">{lede}</p> : null}
    </header>
  )
}

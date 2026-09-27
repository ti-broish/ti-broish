import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { isProtocolDay } from '../signup/election'

const links = [
  { to: '/about', label: 'Кампанията' },
  { to: '/news', label: 'Актуално' },
  { to: '/instructions', label: 'Инструкции' },
  { to: '/signal', label: 'Подай сигнал' },
  { to: '/profil', label: 'Профил' },
] as const

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const path = useRouterState({ select: (state) => state.location.pathname })
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
      <main className={path === '/signup' || path.startsWith('/admin') ? 'mx-auto w-full max-w-lg bg-white px-4 py-8 lg:max-w-6xl' : 'mx-auto w-full max-w-lg bg-white px-4 py-8'}>{children}</main>
      <div className="h-10 bg-[#2b062f]" />
      <footer className="bg-[#eee] text-[#333]">
        <nav className="mx-auto flex max-w-lg flex-wrap gap-x-4 gap-y-2 px-4 py-6">
          <Link to="/kontakt" className="font-bold text-[#333] no-underline">
            Контакт
          </Link>
          <Link to="/signup" search={{ step: 'contact' }} className="font-bold text-[#333] no-underline">
            Запиши се
          </Link>
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
          <a className="font-bold text-[#333]" href="https://www.facebook.com/tibroish/">
            Facebook
          </a>
          <a className="font-bold text-[#333]" href="https://www.instagram.com/tibroish/">
            Instagram
          </a>
          <a className="font-bold text-[#333]" href="https://www.tiktok.com/@tibroish">
            TikTok
          </a>
        </nav>
        <p className="bg-[#666] py-4 text-center font-bold text-white">Ти Броиш © {new Date().getFullYear()}</p>
      </footer>
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

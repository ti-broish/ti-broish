import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { loadOwnDesignation } from '../signup/own-designation-load'
import type { OwnDesignation } from '../signup/own-designation'

/** Same-origin route: the server finds the file by the session, never by an id in the URL. */
export const OWN_DESIGNATION_PDF_PATH = '/profil/palnomoshtno.pdf'

/** The session's own пълномощно, loaded once the profile has an e-mail. null until loaded and when there is none. */
export function useOwnDesignation(enabled: boolean) {
  const [designation, setDesignation] = useState<OwnDesignation | null>(null)
  useEffect(() => {
    if (!enabled) {
      setDesignation(null)
      return
    }
    let cancelled = false
    void loadOwnDesignation()
      .then((result) => {
        if (!cancelled) setDesignation(result ?? null)
      })
      .catch(() => {
        if (!cancelled) setDesignation(null)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])
  return designation
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-0.5 rounded-xl bg-white/10 px-3 py-2">
      <dt className="text-xs font-bold uppercase tracking-wide text-white/70">{label}</dt>
      <dd className={`text-lg font-black text-white ${mono ? 'tabular-nums tracking-wide' : ''}`}>{value}</dd>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg className="h-7 w-7 flex-none" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  )
}

export function OwnDesignationCard({ designation }: { designation: OwnDesignation }) {
  if (designation.state === 'resigning') {
    return (
      <section
        className="grid gap-2 rounded-3xl border-2 border-dashed border-[var(--line)] bg-[#f7f7f7] p-5 sm:p-6"
        aria-label="Твоето пълномощно"
        data-testid="own-designation"
        data-state="resigning"
      >
        <p className="text-sm font-bold text-[#666]">Твоето пълномощно · № {designation.number}</p>
        <h2 className="text-2xl font-black text-[#444]">Подписва се</h2>
        <p className="leading-7">Данните ти са променени и пълномощното се подписва наново. Ще можеш да го свалиш оттук, щом е готово.</p>
      </section>
    )
  }
  return (
    <section
      className="relative overflow-hidden rounded-3xl bg-[var(--purple)] p-5 text-white shadow-[0_12px_32px_rgba(43,6,47,0.25)] sm:p-7"
      aria-labelledby="own-designation-title"
      data-testid="own-designation"
      data-state="signed"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-20 hidden h-56 w-56 rounded-full bg-[var(--teal)] opacity-15 sm:block" />
      <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-center lg:gap-8">
        <div className="grid gap-4">
          <div className="grid gap-1">
            <p className="flex items-center gap-2 text-sm font-bold text-[var(--teal)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12 5 5 9-10" />
              </svg>
              Подписано
            </p>
            <h2 id="own-designation-title" className="text-3xl font-black leading-tight text-white sm:text-4xl">
              Твоето пълномощно
            </h2>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Fact label="Номер" value={`№ ${designation.number}`} mono />
            {designation.mir ? <Fact label="МИР" value={designation.mir} mono /> : null}
            {designation.section ? (
              <div className="col-span-2 sm:col-span-1">
                <Fact label="Секция" value={designation.section} mono />
              </div>
            ) : null}
          </dl>
        </div>
        <div className="grid gap-3">
          <a
            href={OWN_DESIGNATION_PDF_PATH}
            download
            className="brand-button min-h-16 gap-3 text-left text-[18px] leading-snug no-underline shadow-[0_6px_0_rgba(0,0,0,0.25)] sm:text-[20px]"
            style={{ color: 'var(--purple)' }}
          >
            <DownloadIcon />
            <span>Изтегли подписаното пълномощно (PDF)</span>
          </a>
          <p className="text-sm leading-6 text-white/85">
            Пълномощното е достатъчно да е на телефона ти, не е нужно да го печаташ. В изборния ден трябва да имаш отпечатана значката (отличителен знак).
          </p>
          <Link
            to="/znachka"
            className="flex min-h-12 items-center justify-center rounded-[20px] border-2 border-white/70 px-5 text-center text-lg font-bold text-white no-underline hover:bg-white/10"
            style={{ color: '#fff' }}
          >
            Отпечатай значката
          </Link>
        </div>
      </div>
    </section>
  )
}

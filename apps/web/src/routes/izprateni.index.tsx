import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { isProtocolDay } from '../signup/election'
import { readReports } from '../signup/report-memory'
import { listReports, type ReportSummary } from '../signup/reports'

export const Route = createFileRoute('/izprateni/')({ component: SentPage })

const labels = { violation: 'Сигнал', protocol: 'Протокол', call: 'Обаждане' } as const

function SentPage() {
  const [items, setItems] = useState<ReportSummary[] | null>(null)

  useEffect(() => {
    const known = readReports()
    // Signals sent to the API are listed from this browser's memory; older reports come from D1.
    const fromApi: ReportSummary[] = known
      .filter((item) => item.source === 'api')
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        createdAt: item.createdAt ?? '',
        title: item.title || 'Сигнал',
        photoCount: item.photoCount ?? 0,
      }))
    const stored = known.filter((item) => item.source !== 'api')
    void listReports({ data: { known: stored } })
      .catch(() => ({ items: [] as ReportSummary[] }))
      .then((result) =>
        setItems([...fromApi, ...result.items.filter((item) => !fromApi.some((own) => own.id === item.id))].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        )),
      )
  }, [])

  return (
    <div className="grid gap-4">
      <PageIntro title="Изпратените от теб" lede="Сигнали, протоколи и обаждания от този профил и от този браузър." />
      <Link to="/signal" className="brand-button">
        Подай сигнал
      </Link>
      {isProtocolDay() ? (
        <Link to="/protokol" className="brand-button">
          Изпрати протокол
        </Link>
      ) : null}
      {items === null ? <p>Зареждаме…</p> : null}
      {items?.length === 0 ? <p>Още няма изпратени от този браузър.</p> : null}
      <ul className="grid gap-3">
        {items?.map((item) => {
          const secret = readReports().find((known) => known.id === item.id)?.secret ?? ''
          return (
            <li key={item.id}>
              <Link
                to="/izprateni/$id"
                params={{ id: item.id }}
                search={{ secret }}
                className="block rounded-2xl border border-[var(--line)] bg-white px-4 py-3 leading-7 text-[#333] no-underline"
              >
                <span className="font-bold">{labels[item.kind]}</span>
                <span className="mt-1 block">{item.title}</span>
                <span className="mt-1 block text-sm">
                  {new Date(item.createdAt).toLocaleString('bg-BG')}
                  {item.photoCount > 0 ? ` · ${item.photoCount} снимки` : ''}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

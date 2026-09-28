import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageIntro } from '../components/SiteChrome'
import { placeLabel } from '../signup/model'
import { getReport, type ReportDetail } from '../signup/reports'

export const Route = createFileRoute('/izprateni/$id')({
  validateSearch: (search: Record<string, unknown>): { secret: string } => ({
    secret: typeof search.secret === 'string' ? search.secret : '',
  }),
  component: ReportPage,
})

const labels = { violation: 'Сигнал', protocol: 'Протокол', call: 'Обаждане' } as const

function ReportPage() {
  const { id } = Route.useParams()
  const { secret } = Route.useSearch()
  const [report, setReport] = useState<ReportDetail | null | undefined>(undefined)

  useEffect(() => {
    void getReport({ data: { id, secret } }).then(setReport)
  }, [id, secret])

  if (report === undefined) return <p>Зареждаме…</p>
  if (!report) {
    return (
      <div className="grid gap-4">
        <PageIntro title="Не намираме това изпратено" lede="Отвори го от браузъра, от който си го пратил, или от профила." />
        <Link to="/izprateni" className="brand-button">
          Изпратените от теб
        </Link>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <PageIntro title={labels[report.kind]} lede={new Date(report.createdAt).toLocaleString('bg-BG')} />
      <p className="rounded-2xl bg-[#eee] px-4 py-3">Получихме го. Екипът го преглежда.</p>
      {report.description ? <p className="leading-7">{report.description}</p> : null}
      {report.note ? <p className="leading-7">{report.note}</p> : null}
      {report.message ? <p className="leading-7">{report.message}</p> : null}
      {report.name ? <p>{report.name}</p> : null}
      {report.email ? <p>{report.email}</p> : null}
      {report.phone ? <p>{report.phone}</p> : null}
      {report.place ? <p>{placeLabel(report.place)}</p> : null}
      {report.wantCall ? <p>Искаш обаждане по този сигнал.</p> : null}
      <ul className="grid gap-3">
        {report.photos.map((src) => (
          <li key={src.slice(0, 48)}>
            <img src={src} alt="" className="w-full rounded-xl" />
          </li>
        ))}
      </ul>
      <Link to="/izprateni" className="brand-button">
        Назад към изпратените
      </Link>
    </div>
  )
}

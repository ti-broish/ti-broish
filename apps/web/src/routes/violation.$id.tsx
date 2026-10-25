import { Link, createFileRoute } from '@tanstack/react-router'
import { loadPublicViolation } from '../home/results-fns'
import { validAfter } from '../home/violations'

// /violation/<id>: one published signal (results: ViolationSummary.js). Only what the API shows without a secret.
export const Route = createFileRoute('/violation/$id')({
  loader: async ({ params }) => (validAfter(params.id) ? loadPublicViolation({ data: params.id }) : null),
  head: ({ params }) => ({ meta: [{ title: `Сигнал ${params.id} · Ти Броиш` }] }),
  component: ViolationPage,
})

// results: new Date(createdAt).toLocaleString('bg-BG'), pinned to Sofia so the server and the browser agree.
const receivedFormat = new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', dateStyle: 'short', timeStyle: 'medium' })
function receivedAt(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : receivedFormat.format(date)
}

function ViolationPage() {
  const violation = Route.useLoaderData()
  const { id } = Route.useParams()
  if (!violation) {
    return (
      <div className="rs-page">
        <h1>
          Сигнал <span className="rs-violation-id">{id}</span>
        </h1>
        <p>Не е намерен сигнал с този номер</p>
      </div>
    )
  }
  const town = violation.town
  const region = violation.section?.electionRegion ?? (town?.municipality?.electionRegions?.length === 1 ? town.municipality.electionRegions[0] : null)
  return (
    <div className="rs-page rs-violation-summary">
      <h1>
        Сигнал <span className="rs-violation-id">{violation.id}</span>
      </h1>
      {violation.section ? (
        <p>
          Секция: <Link className="rs-link" to="/$unit" params={{ unit: violation.section.id }}>{violation.section.id}</Link>
        </p>
      ) : null}
      {town ? (
        <p>
          {town.municipality ? `Община: ${town.municipality.name}` : `Държава: ${town.country?.name ?? ''}`}, Населено място: {town.name}
        </p>
      ) : null}
      {region ? (
        <p>
          Област: <Link className="rs-link" to="/$unit" params={{ unit: region.code }}>{region.name}</Link>
        </p>
      ) : null}
      <p>Статус: {violation.statusLocalized}</p>
      {violation.createdAt ? <p>Получен на: {receivedAt(violation.createdAt)}</p> : null}
      <p>
        <b>Нарушение:</b>
        <br /> <br /> {violation.publishedText}
      </p>
      {(violation.pictures ?? []).length > 0 ? (
        <div className="rs-violation-summary__pictures">
          {(violation.pictures ?? []).map((picture) => (
            <img key={picture.url} src={picture.url} alt="" loading="lazy" />
          ))}
        </div>
      ) : null}
    </div>
  )
}

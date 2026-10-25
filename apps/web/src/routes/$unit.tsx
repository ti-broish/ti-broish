import { createFileRoute, notFound } from '@tanstack/react-router'
import { Aggregation, Section } from '../components/results/UnitPages'
import { isSection, unitTitle, validUnitPath } from '../home/results'
import { loadResultsUnit } from '../home/results-fns'

// /<МИР>, /<община>, /<район>, /<държава>, /<секция>: the old results site's unit pages (results: /:unit).
export const Route = createFileRoute('/$unit')({
  loader: async ({ params }) => {
    if (!validUnitPath(params.unit)) throw notFound()
    const payload = await loadResultsUnit({ data: params.unit })
    if (payload.error) throw new Error('Данните не се заредиха. Опитай пак след малко.')
    if (!payload.unit) throw notFound()
    return payload
  },
  head: ({ loaderData }) => ({
    meta: loaderData?.unit
      ? [{ title: isSection(loaderData.unit.segment) ? `Секция ${loaderData.unit.segment} · Ти Броиш` : `${unitTitle(loaderData.unit)} · Ти Броиш` }]
      : [],
  }),
  component: UnitPage,
})

function UnitPage() {
  const { unit, meta } = Route.useLoaderData()
  const { unit: segment } = Route.useParams()
  if (!unit) return null
  return isSection(segment) ? (
    <Section key={segment} data={unit} meta={meta} />
  ) : (
    <Aggregation key={segment} data={unit} segment={segment} />
  )
}

import { Link, createFileRoute, useRouterState } from '@tanstack/react-router'
import { Aggregation } from '../components/results/UnitPages'
import { signalQuery } from '../components/results/ViolationFeed'
import { WhenProtocolOpen } from '../components/WhenProtocolOpen'
import { loadResultsUnit } from '../home/results-fns'
import { signupsClosed } from '../signup/signups-closed'
import { useRegistration } from '../signup/use-registration'

// Home: the old results site's front page (https://github.com/ti-broish/results, units/Aggregation.js):
// the map of election regions (a click opens /<МИР>), their table and the feed of published signals.
// Data from api.tibroish.bg through the worker (src/home/results.server.ts, /api/violations).
// ?origin=iaz and the other /signal parameters are passed on to „Подай сигнал“; ?demo=1 shows sample signals
// in the feed outside production (src/home/violations.server.ts).
type HomeSearch = { demo?: 1 }

export const Route = createFileRoute('/')({
  // Only ?demo is read here. The rest of the query (origin, name, email, oblast) is left as typed and
  // handed to /signal unchanged, so the router does not rewrite the address (it would quote oblast=23).
  validateSearch: (search: Record<string, unknown>): HomeSearch => (search.demo === 1 || search.demo === '1' ? { demo: 1 } : {}),
  loader: () => loadResultsUnit({ data: 'index' }),
  component: HomePage,
})

function HomePage() {
  const { meta, unit } = Route.useLoaderData()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const { settled, pending } = useRegistration()

  return (
    <div className="grid gap-4">
      <header className="rs-home-header">
        <h1>{meta?.name ?? 'Сигнали от изборния ден'}</h1>
        <div className="flex flex-col gap-3 sm:flex-row">
          <a href={`/signal${signalQuery(searchStr)}`} className="brand-button sm:flex-1">
            Подай сигнал
          </a>
          <WhenProtocolOpen>
            <Link to="/protokol" className="brand-button sm:flex-1">
              Изпрати протокол
            </Link>
          </WhenProtocolOpen>
        </div>
        {settled ? (
          <p>
            Вече си записан. <Link to="/profil">Към профила</Link>
          </p>
        ) : pending || signupsClosed() ? null : (
          // The signup button (signups-closed.ts is the switch): back for the runoff.
          <Link to="/signup" search={{ step: 'contact' }} className="brand-button" data-testid="home-signup">
            Запиши се
          </Link>
        )}
      </header>
      {unit ? <Aggregation data={unit} /> : <p role="alert">Картата не се зареди. Опитай пак след малко.</p>}
    </div>
  )
}

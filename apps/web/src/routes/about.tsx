import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'
import { signupsClosed } from '../signup/signups-closed'
import { ELECTION_LABEL, RUNOFF_LABEL, firstRoundPassed } from '../signup/election'

export const Route = createFileRoute('/about')({ component: AboutPage })

function AboutPage() {
  return (
    <article className="max-w-3xl space-y-4 text-base leading-7">
      <PageIntro title="Какво е „Ти Броиш“?" />
      <p>
        „Ти Броиш“ тръгва през 2020 г. Оттогава е гражданската платформа, през която хората пазят честността на изборите в България. Записалите се застъпници и наблюдатели са над 50 хиляди.
      </p>
      <p>
        {firstRoundPassed()
          ? `За балотажа на ${RUNOFF_LABEL} 2026 г. търсим пазители на вота в секциите в страната и в чужбина.`
          : `На ${ELECTION_LABEL} 2026 г. търсим пазители на вота в секциите в страната и в чужбина. Балотажът е на ${RUNOFF_LABEL}. По-добре е да можеш и на двата дни.`}
      </p>
      <p>
        Попълваш данните си и потвърждаваш имейла още в началото. В изборния ден влизаш най-късно час преди затварянето и оставаш до края на протокола.
      </p>
      {signupsClosed() ? (
        <Link to="/vhod" className="brand-button">
          Вход
        </Link>
      ) : (
        <Link to="/signup" search={{ step: 'contact' }} className="brand-button">
          Запиши се
        </Link>
      )}
      <p className="font-bold">Това е доброволна дейност без заплащане.</p>
    </article>
  )
}

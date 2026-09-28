import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'

export const Route = createFileRoute('/izvan-bulgaria')({ component: AbroadPage })

function AbroadPage() {
  return (
    <article className="max-w-3xl space-y-4 text-base leading-7">
      <PageIntro
        title="Секции в чужбина"
        lede="Ако си извън България, в записването избери „Извън страната“, после държава и град."
      />
      <p>
        За да гласуваш извън страната, подаваш отделно заявление по реда на ЦИК. Записването тук е за пазител на вота. То не те вписва в избирателния списък.
      </p>
      <p>Можеш да гласуваш само там, където обичайно гласуваш. Секцията, в която те пратим, не ти дава право на глас там.</p>
      <Link to="/signup" search={{ step: 'contact' }} className="brand-button">
        Запиши се
      </Link>
    </article>
  )
}

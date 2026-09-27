import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'

export const Route = createFileRoute('/kontakt')({ component: ContactPage })

function ContactPage() {
  return (
    <article className="grid gap-6 text-lg leading-7">
      <PageIntro title="Връзка с нас" lede="Обаждане или имейл се иска, докато се записваш." />
      <p>В профила отбелязваш „Поискай обаждане от екипа“ и оставяш телефон. Отделно писмо не пращаш оттук.</p>
      <Link to="/signup" search={{ step: 'contact' }} className="brand-button">
        Запиши се
      </Link>
      <p>
        Преди това виж <Link to="/faq">въпросите и отговорите</Link>.
      </p>
    </article>
  )
}

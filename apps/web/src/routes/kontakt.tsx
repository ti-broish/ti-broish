import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'

export const Route = createFileRoute('/kontakt')({ component: ContactPage })

function ContactPage() {
  return (
    <article className="grid gap-6 text-lg leading-7">
      <PageIntro title="Връзка с нас" lede="Ако искаш да говорим, поискай обаждане. Екипът ще ти звънне." />
      <p>
        Записал ли си се? В профила отбелязваш „Поискай обаждане от екипа“. Ще ти звъннем на телефона от записа.
      </p>
      <p>Ако още не си се записал, отвори профила и остави име, телефон и по какъв въпрос е обаждането.</p>
      <Link to="/signup" search={{ step: 'contact' }} className="brand-button">
        Запиши се
      </Link>
      <p>
        <Link to="/profil">Отвори профила</Link>, ако искаш само обаждане.
      </p>
      <p>
        Ако първо търсиш отговор, виж <Link to="/faq">въпросите и отговорите</Link>.
      </p>
    </article>
  )
}

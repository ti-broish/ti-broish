import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'

export const Route = createFileRoute('/kontakt')({ component: ContactPage })

function ContactPage() {
  return (
    <article className="grid gap-6 text-lg leading-7">
      <PageIntro title="Връзка с нас" lede="Ако искаш да говорим, остави телефон. Екипът ще ти звънне." />
      <p>
        Ако вече си се записал, отвори профила и натисни „Поискай обаждане от екипа“. Ще ти звъннем на телефона от записването.
      </p>
      <p>Ако още не си се записал, отвори профила и остави име, телефон и за какво е обаждането.</p>
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

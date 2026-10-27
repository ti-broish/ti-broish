import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'
import { signupsClosed } from '../signup/signups-closed'

export const Route = createFileRoute('/kontakt')({ component: ContactPage })

function ContactPage() {
  return (
    <article className="grid gap-6 text-lg leading-7">
      <PageIntro title="Връзка с нас" lede="Ако искаш да говорим, остави телефон. Екипът ще ти звънне." />
      <p>
        Ако вече си се записал, отвори профила, отметни „Искам екипът да ми се обади“ и напиши за какво е. Ще ти звъннем на телефона от записването.
      </p>
      <p>Ако още не си се записал, отвори профила и остави име, телефон и за какво е обаждането.</p>
      {signupsClosed() ? (
        <Link to="/vhod" className="brand-button">
          Вход
        </Link>
      ) : (
        <Link to="/signup" search={{ step: 'contact' }} className="brand-button">
          Запиши се
        </Link>
      )}
      <p>
        <Link to="/profil">Отвори профила</Link>, ако искаш само обаждане.
      </p>
      <p>
        Ако първо търсиш отговор, виж <Link to="/faq">въпросите и отговорите</Link>.
      </p>
    </article>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'

export const Route = createFileRoute('/privacy-notice')({ component: PrivacyPage })

function PrivacyPage() {
  return (
    <article className="max-w-3xl space-y-4 text-base leading-7">
      <PageIntro title="Декларация за поверителност" />
      <p>
        Администратор на личните данни за сайта tibroish.bg е ПП „Движение Да България“. Длъжностно лице по защита на данните е Божидар Божанов. Пишете на team@tibroish.bg.
      </p>
      <p>
        В записването събираме трите имена, имейл, телефон и как искаш да участваш: роля, дни, опит, място, докъде пътуваш и свободни места в колата. След като потвърдиш имейла, питаме и за ЕГН. То ни трябва, за да те разпределим и за дигиталното пълномощно. Не искаме номер на лична карта или постоянен адрес.
      </p>
      <p>
        Данните са за доброволната кампания: да потвърдим имейла, да пазим профила ти, да те разпределим в секция и да ти кажем следващите стъпки. Записването, сигналът и протоколът се пазят в базата на кампанията.
      </p>
      <p>
        По-ранният текст е на <a href="https://tibroish.bg/privacy-notice">tibroish.bg/privacy-notice</a>. Той описва предишното записване. Този текст е за сегашното записване.
      </p>
    </article>
  )
}

import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'
import { joinIntro, mobileTeamText, paperSectionText, votingLogistics } from '../signup/copy'

export const Route = createFileRoute('/')({ component: HomePage })

const frame = 'rounded-[20px] border border-[#ddd] bg-white px-4 py-4'
const callout = 'rounded-[20px] border border-[#53c0a4] bg-[#e4f5f0] px-4 py-4'

function HomePage() {
  return (
    <div className="grid gap-6">
      <PageIntro
        title="Пазители на вота за всяка секция."
        lede="Президентски избори 2026 г. на 25 октомври и 1 ноември. Запиши се, потвърди имейла и избери секция или мобилен екип."
      />
      <Link to="/signup" search={{ step: 'contact' }} className="brand-button">
        Запиши се
      </Link>
      <div className="grid gap-4 text-lg leading-7">
        <p>{joinIntro}</p>
        <div className="grid gap-3">
          <article className={frame}>
            <h2 className="text-lg font-black">В секция</h2>
            <p className="mt-1">{paperSectionText}</p>
          </article>
          <article className={frame}>
            <h2 className="text-lg font-black">Мобилен екип</h2>
            <p className="mt-1">{mobileTeamText}</p>
          </article>
        </div>
        <p className={callout}>
          <strong>Важно!</strong> {votingLogistics}
        </p>
        <h2 className="text-xl font-black text-[#444]">След като се запишеш</h2>
        <p>В профила виждаш датата, на която пускаме секциите: 5, 12 или 19 октомври, и 26 октомври за балотажа.</p>
        <p>Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев. Това е доброволна дейност без заплащане.</p>
      </div>
    </div>
  )
}

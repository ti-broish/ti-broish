import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'

export const Route = createFileRoute('/')({ component: HomePage })

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
        <p>
          <strong>В секция.</strong> В избраното място първо те пращаме в хартиена секция. Машинна идва само ако там вече има твърде много хора. Ти не избираш кое от двете.
        </p>
        <p>
          <strong>Мобилен екип.</strong> Не си вързан за една секция и пак казваш къде можеш да бъдеш.
        </p>
        <p>Можеш да добавиш и други хора и да отидете заедно като група.</p>
        <h2 className="text-xl font-black text-[#444]">След като се запишеш</h2>
        <p>В профила виждаш датата, на която пускаме секциите: 5, 12 или 19 октомври, и 26 октомври за балотажа.</p>
        <p>Ще бъдете представител на Инициативния комитет за кандидат-президентската двойка Андрей Гюров и Георги Кандев. Това е доброволна дейност без заплащане.</p>
      </div>
    </div>
  )
}

import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'

export const Route = createFileRoute('/faq')({ component: FaqPage })

const questions = [
  ['За кои избори е записването?', 'За президентските избори на 25 октомври 2026 г. и за 1 ноември.'],
  ['Къде се записвам?', 'От началната страница, с бутона „Запиши се“.'],
  ['Мога ли да избера машинна секция?', 'Не. Хартиените секции в избраното място са първи. Машинна остава, ако хартиените вече са заети.'],
  ['Мога ли да дойда с други хора?', 'Да. В записването добавяш пазители в група, или хора извън групата, ако ги записваш като координатор.'],
  ['Кога ще видя секцията си?', 'В профила, на следващата дата за разпределение: 5, 12 или 19 октомври, и 26 октомври за 1 ноември. Тогава идва и имейл.'],
  ['Защо се иска ЕГН?', 'След потвърдения имейл, за разпределението и за дигиталното пълномощно. Не се показва в списъци.'],
  ['Как да поискам обаждане?', 'От профила. Ако си се записал, обаждането е на телефона от записа. Ако не си, оставяш там име и телефон.'],
]

function FaqPage() {
  return (
    <article className="grid gap-6">
      <PageIntro title="Въпроси и отговори" />
      {questions.map(([title, text]) => (
        <section key={title} className="grid gap-2">
          <h2 className="text-xl font-black text-[#444]">{title}</h2>
          <p className="text-lg leading-7">{text}</p>
        </section>
      ))}
      <section className="grid gap-2">
        <h2 className="text-xl font-black text-[#444]">Ако съм извън България?</h2>
        <p className="text-lg leading-7">
          <Link to="/izvan-bulgaria">Страницата „Извън страната“</Link> казва как се избира държава и град. Това не те записва в избирателния списък.
        </p>
      </section>
    </article>
  )
}

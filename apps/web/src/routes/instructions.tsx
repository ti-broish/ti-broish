import { Link, createFileRoute } from '@tanstack/react-router'
import { PageIntro } from '../components/SiteChrome'
import { isProtocolDay } from '../signup/election'

export const Route = createFileRoute('/instructions')({ component: InstructionsPage })

const files = [
  ['Наръчник на пазителя на вота', 'https://tibroish.bg/files/Narachnik-Ti-broish.pdf'],
  ['Обучителен материал, НС 27.10.2024', 'https://tibroish.bg/files/Ти%20Броиш%20Обучителен%20материал%20-%20НС%2027.10.2024.pdf'],
]

const lessons = [
  ['Защитник на вота - права и задължения', 'Qz4V6uu7gTM'],
  ['Кой може да гласува', '3hpv4iwoAmA'],
  ['Как се гласува - с хартия, с машина', '-RvdMym5nm8'],
  ['Как се гласува в чужбина', 'O-pWXJq_710'],
  ['Как функционира СИК', 'MpX0bA_DRtE'],
  ['Как откриваме изборния ден', '8J8r-e4shS8'],
  ['Как приключва изборния ден', 'VbyHA1Ksr0Q'],
  ['Как броим', '9WAcSKL-hQg'],
  ['Как попълваме протокола', 'ZfoL4VLitXI'],
  ['Как предаваме протокола в РИК', 'Xm0f61Xv0Pc'],
] as const

const sending = [
  ['Изпращане на протокол в Ти Броиш', 'vG-evl0Jlp8'],
  ['Подаване на сигнал в Ти Броиш', 'x4j9s-LliVs'],
] as const

function InstructionsPage() {
  return (
    <article className="max-w-3xl space-y-4 text-base leading-7">
      <PageIntro
        title="Преди да влезеш в секцията"
        lede="Материалите за тези президентски избори още се пишат. Дотогава важат правилата от досегашните кампании."
      />
      <ul className="list-disc space-y-2 pl-5">
        <li>Изборният ден е от 7:00 до 20:00 ч.</li>
        <li>Влез най-късно час преди затваряне и остани до края на протокола.</li>
        <li>Не пречиш на работата на СИК. Ако видиш нарушение, не го отминавай.</li>
        <li>Работата свършва, когато имаш копие от протокола.</li>
        <li>
          Ако СИК не отстрани нарушението, подаваш го от <Link to="/signal">сигнала</Link>. Копието от протокола се праща в изборния ден
          {isProtocolDay() ? (
            <>
              {' '}
              от <Link to="/protokol">протокола</Link>
            </>
          ) : null}
          . Работи и без профил.
        </li>
      </ul>
      <ul className="space-y-3 text-lg leading-7">
        {files.map(([label, href]) => (
          <li key={href}>
            <a href={href}>{label}</a>
          </li>
        ))}
      </ul>
      <h2 className="text-xl font-black text-[#444]">Уроци от досегашните кампании</h2>
      <p>
        Видеата са от предишни избори. За 25 октомври и 1 ноември материалите още се пишат, затова гледай тези, докато излязат новите.
      </p>
      <ul className="space-y-3 text-lg leading-7">
        {lessons.map(([label, id]) => (
          <li key={id}>
            <a href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          </li>
        ))}
      </ul>
      <h2 className="text-xl font-black text-[#444]">Протокол и сигнал</h2>
      <ul className="space-y-3 text-lg leading-7">
        {sending.map(([label, id]) => (
          <li key={id}>
            <a href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          </li>
        ))}
      </ul>
      <Link to="/signup" search={{ step: 'contact' }} className="brand-button">
        Запиши се
      </Link>
    </article>
  )
}

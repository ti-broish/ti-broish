import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AdminHeading } from '../../components/admin-ui'
import { adminPartnerPerson } from '../../signup/admin'
import { defaultSignupSearch } from '../../signup/admin-search'
import { IazBadge, IAZ_ROW_TINT } from './-iaz-row'

export const Route = createFileRoute('/admin/iaz/$personId')({
  component: PartnerPersonPage,
})

type Loaded = Awaited<ReturnType<typeof adminPartnerPerson>>
type Found = Extract<Loaded, { ok: true }>

function when(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', dateStyle: 'medium', timeStyle: 'short' })
}

function PartnerPersonPage() {
  const { personId } = Route.useParams()
  const [state, setState] = useState<{ phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; data: Found }>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    void adminPartnerPerson({ data: { id: personId } })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) setState({ phase: 'error', message: result.message })
        else setState({ phase: 'ready', data: result })
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error', message: 'Записът не се зареди.' })
      })
    return () => {
      cancelled = true
    }
  }, [personId])

  const back = (
    <Link to="/admin/signups" search={{ ...defaultSignupSearch, source: 'iaz' }} className="text-sm font-bold text-[#2b062f] underline">
      ← Записвания („И аз“)
    </Link>
  )
  if (state.phase === 'loading') return <div className="grid gap-4">{back}<p role="status">Зареждаме…</p></div>
  if (state.phase === 'error') {
    return (
      <div className="grid gap-4">
        {back}
        <p className="rounded-xl border-2 border-[#8f1d1d] bg-[#fff5f5] px-3 py-2 text-sm font-bold text-[#8f1d1d]" role="alert">{state.message}</p>
      </div>
    )
  }
  const { person, signups } = state.data
  const rows: Array<[string, string]> = [
    ['Имейл', person.email || '—'],
    ['Телефон', person.phone || '—'],
    ['ЕГН', person.egnMasked || '—'],
    ['Област / община', [person.region, person.municipality].filter(Boolean).join(' · ') || '—'],
    ['Място (от „И аз“)', person.placeNote || '—'],
    ['Пълномощно', person.number ? `№ ${person.mir}/${person.number}` : 'Без номер'],
    ['Издадено', when(person.issuedAt)],
    ['Подписано', person.signedAt ? when(person.signedAt) : 'Не е качено подписано'],
    ['Секция', person.sectionPublished ? `Публикувана ${person.sectionPublished}` : person.sectionDraft ? `Чернова ${person.sectionDraft}` : 'Без секция'],
    ['Записан в „И аз“', when(person.submittedAt)],
    ['Внесен при нас', when(person.importedAt)],
  ]
  return (
    <div className="grid gap-5">
      {back}
      <AdminHeading
        title={person.name || 'Запис от „И аз“'}
        lede="Внесен от „И аз“ само за пълномощно. Не е записване при нас: не получава писма и не отива в Brevo. Секцията, номерът и подписаното пълномощно са от този запис."
      />
      <div className={`grid gap-3 rounded-2xl border-2 border-[#2b062f] p-4 ${IAZ_ROW_TINT}`} data-testid="iaz-person">
        <p><IazBadge /></p>
        {person.withdrawnAt ? <p className="font-bold text-[#7a1f4b]">Оттеглен на {when(person.withdrawnAt)}</p> : null}
        <dl className="grid gap-2 text-sm text-[#1a1020] sm:grid-cols-[12rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-bold">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {person.pdfUrl ? (
          <p className="text-sm">
            <a className="font-bold text-[#2b062f] underline" href={person.pdfUrl} target="_blank" rel="noreferrer">Подписаното пълномощно</a>
          </p>
        ) : null}
        <p className="text-sm">
          <Link className="font-bold text-[#2b062f] underline" to="/admin/palnomoshtni" hash="i-az">Пълномощни → „И аз“</Link>
        </p>
      </div>
      <section className="grid gap-2">
        <h2 className="text-lg font-black text-[#1a1020]">Записвания при нас със същото ЕГН или имейл</h2>
        {signups.length === 0 ? <p className="text-sm text-[#333]">Няма.</p> : (
          <ul className="grid gap-2 text-sm text-[#1a1020]">
            {signups.map((signup) => (
              <li key={signup.id} className="rounded-xl border border-[#cfc3d2] p-3">
                <Link to="/admin/signups/$personId" params={{ personId: signup.id }} className="font-bold text-[#2b062f] underline">
                  {signup.name || signup.email || signup.id}
                </Link>{' '}
                · {signup.email} ·{' '}
                {signup.withdrawn ? 'Отписан' : signup.finished ? 'Завършил' : `Недовършено (${signup.submitted ? 'изпратено' : 'не е изпратено'}, ${signup.confirmed ? 'имейлът е потвърден' : 'имейлът не е потвърден'})`}
                {signup.number ? ` · пълномощно № ${signup.number}` : ''}
                {signup.publishedSection ? ` · секция ${signup.publishedSection}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

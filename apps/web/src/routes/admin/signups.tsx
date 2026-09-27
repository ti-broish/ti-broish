import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageIntro } from '../../components/SiteChrome'
import { adminExport, adminImportPeople, adminResendImports, adminRoster } from '../../signup/admin'
import type { RosterFields } from '../../signup/admin-csv'

export const Route = createFileRoute('/admin/signups')({
  component: SignupsPage,
})

const views = [
  ['all', 'Всички'],
  ['assigned', 'Със секция'],
  ['unassigned', 'Без секция'],
  ['abroad', 'Чужбина'],
] as const

const ghost = 'flex min-h-11 items-center justify-center rounded-[20px] border border-[#ddd] bg-white px-4 text-sm font-bold'

function SignupsPage() {
  const [view, setView] = useState<(typeof views)[number][0] | 'mir'>('all')
  const [mir, setMir] = useState('')
  const [people, setPeople] = useState<RosterFields[]>([])
  const [total, setTotal] = useState(0)
  const [message, setMessage] = useState('')
  const [links, setLinks] = useState<{ email: string; link: string }[]>([])
  const [canExport, setCanExport] = useState(false)
  const [canInternal, setCanInternal] = useState(false)
  const [canEdit, setCanEdit] = useState(false)

  function load(nextView = view, nextMir = mir) {
    void adminRoster({ data: { view: nextView, mir: nextMir } }).then((result) => {
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setPeople(result.people)
      setTotal(result.total)
      setCanExport(result.permissions.exportCampaign)
      setCanInternal(result.permissions.exportInternal)
      setCanEdit(result.permissions.edit)
    })
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="grid gap-6">
      <PageIntro title="Записвания" lede="Хората, които са се записали. CSV за Brevo е за кампанията. Вътрешното CSV е за екипа и пази само последните 4 цифри на ЕГН." />
      <div className="flex flex-wrap gap-2">
        {views.map(([id, label]) => (
          <button key={id} type="button" className={view === id ? 'min-h-10 rounded-full bg-[#333] px-3 text-sm font-bold text-white' : ghost} onClick={() => { setView(id); load(id, mir) }}>
            {label}
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setView('mir')
          load('mir', mir)
        }}
      >
        <label className="grid gap-1 text-sm font-semibold">
          МИР
          <input className="min-h-11 w-24 rounded-xl border border-[#ddd] bg-white px-3" inputMode="numeric" value={mir} onChange={(event) => setMir(event.target.value)} />
        </label>
        <button className={ghost} type="submit">Покажи МИР</button>
      </form>
      <p className="text-sm">{total} в този изглед{total > people.length ? `. На екрана са първите ${people.length}.` : ''}.</p>
      <div className="flex flex-wrap gap-2">
        {canExport ? <button type="button" className={ghost} onClick={() => void adminExport({ data: { view, mir, kind: 'campaign' } }).then((result) => result.ok ? download(result.filename, result.csv) : setMessage(result.message))}>CSV за Brevo</button> : null}
        {canInternal ? <button type="button" className={ghost} onClick={() => void adminExport({ data: { view, mir, kind: 'internal' } }).then((result) => result.ok ? download(result.filename, result.csv) : setMessage(result.message))}>CSV за екипа</button> : null}
      </div>
      {message ? <p>{message}</p> : null}
      <PeopleTable people={people} />
      {canEdit ? (
        <section className="grid gap-3 border-t border-[#ddd] pt-6">
          <h2 className="text-xl font-black text-[#444]">Хора, въведени от екипа</h2>
          <p>Колони: име, презиме, фамилия, имейл, телефон. До 500 реда.</p>
          <input
            className="min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3"
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV с хора"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              void file.text().then((csv) => adminImportPeople({ data: { csv } })).then((result) => {
                if (!result.ok) {
                  setMessage(result.message)
                  return
                }
                setLinks(result.links)
                setMessage(`Въведени са ${result.imported} души, пропуснати ${result.skipped}, писма ${result.mailed}.`)
                load()
              })
            }}
          />
          <button type="button" className={ghost} onClick={() => void adminResendImports({ data: { limit: 100 } }).then((result) => {
            if (!result.ok) setMessage(result.message)
            else {
              setLinks(result.links)
              setMessage(`Писма: ${result.mailed} от ${result.pending}.`)
            }
          })}>Изпрати чакащите писма</button>
          {links.length > 0 ? (
            <ul className="grid gap-2 text-sm">
              {links.map((item) => (
                <li key={item.email}>{item.email} · <a href={item.link}>{item.link}</a></li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function PeopleTable({ people }: { people: RosterFields[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[#ddd] text-[#666]">
            <th className="py-2 pr-3 font-bold">Човек</th>
            <th className="py-2 pr-3 font-bold">МИР</th>
            <th className="py-2 font-bold">Място</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.id} className="border-b border-[#eee] align-top">
              <td className="py-3 pr-3">
                <p className="font-bold">{person.firstName} {person.lastName}</p>
                <p>{person.email}</p>
                <p className="text-[#666]">{person.phone}</p>
              </td>
              <td className="py-3 pr-3">{person.mir || (person.region === '32' ? 'чужбина' : person.region)}</td>
              <td className="py-3">{person.place}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {people.length === 0 ? <p className="mt-4">Няма хора в този изглед.</p> : null}
    </div>
  )
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

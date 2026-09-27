import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageIntro } from '../../components/SiteChrome'
import { adminDraft, adminImportTaken, adminPublish, adminRoster } from '../../signup/admin'
import type { RosterFields } from '../../signup/admin-csv'

export const Route = createFileRoute('/admin/sections')({
  component: SectionsPage,
})

const views = [
  ['unassigned', 'Без секция'],
  ['draft', 'Чернова'],
  ['assigned', 'Публикувани'],
  ['abroad', 'Чужбина'],
] as const

const ghost = 'flex min-h-11 items-center justify-center rounded-[20px] border border-[#ddd] bg-white px-4 text-sm font-bold'
const button = 'brand-button'

function SectionsPage() {
  const [view, setView] = useState<(typeof views)[number][0] | 'mir'>('unassigned')
  const [mir, setMir] = useState('')
  const [people, setPeople] = useState<RosterFields[]>([])
  const [taken, setTaken] = useState<Array<{ section_code: string; mir_code: string; place: string; organisation: string }>>([])
  const [message, setMessage] = useState('')
  const [armed, setArmed] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [canPublish, setCanPublish] = useState(false)

  function load(nextView = view, nextMir = mir) {
    setArmed(false)
    void adminRoster({ data: { view: nextView, mir: nextMir } }).then((result) => {
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setPeople(result.people)
      setTaken(result.taken)
      setCanEdit(result.permissions.edit)
      setCanPublish(result.permissions.publish)
    })
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="grid gap-6">
      <PageIntro title="Секции" lede="Черновата се вижда само тук. Публикуването я показва в профила. Масовото писмо след това е CSV от Записвания към Brevo." />
      <div className="flex flex-wrap gap-2">
        {views.map(([id, label]) => (
          <button key={id} type="button" className={view === id ? 'min-h-10 rounded-full bg-[#333] px-3 text-sm font-bold text-white' : ghost} onClick={() => { setView(id); load(id, mir) }}>
            {label}
          </button>
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); setView('mir'); load('mir', mir) }}>
        <label className="grid gap-1 text-sm font-semibold">
          МИР
          <input className="min-h-11 w-24 rounded-xl border border-[#ddd] bg-white px-3" inputMode="numeric" value={mir} onChange={(event) => setMir(event.target.value)} />
        </label>
        <button className={ghost} type="submit">Покажи МИР</button>
      </form>
      {canPublish ? (
        <button
          type="button"
          className={armed ? button : ghost}
          onClick={() => {
            if (!armed) {
              setArmed(true)
              return
            }
            void adminPublish({ data: { view, mir } }).then((result) => {
              setArmed(false)
              if (!result.ok) setMessage(result.message)
              else {
                setMessage(`Публикувани са ${result.published} чернови.`)
                load()
              }
            })
          }}
        >
          {armed ? 'Да, покажи ги в профилите' : 'Публикувай черновите в този изглед'}
        </button>
      ) : null}
      {message ? <p>{message}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#ddd] text-[#666]">
              <th className="py-2 pr-3 font-bold">Човек</th>
              <th className="py-2 pr-3 font-bold">Чернова</th>
              <th className="py-2 font-bold">Публикувана</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id} className="border-b border-[#eee] align-top">
                <td className="py-3 pr-3">
                  <p className="font-bold">{person.firstName} {person.lastName}</p>
                  <p>{person.email}</p>
                  <p className="text-[#666]">{person.mir || (person.region === '32' ? 'чужбина' : person.place)}</p>
                </td>
                <td className="py-3 pr-3">
                  {canEdit ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        const section = String(new FormData(event.currentTarget).get('section') ?? '')
                        void adminDraft({ data: { id: person.id, section } }).then((result) => {
                          if (!result.ok) setMessage(result.message)
                          else {
                            setMessage(result.warning || 'Черновата е запазена и не се вижда от човека.')
                            load()
                          }
                        })
                      }}
                    >
                      <input name="section" className="min-h-10 w-32 rounded-xl border border-[#ddd] px-2" defaultValue={person.draftSection} aria-label={`Чернова за ${person.email}`} />
                      <button className="text-sm font-bold" type="submit">Запази</button>
                    </form>
                  ) : person.draftSection}
                </td>
                <td className="py-3">{person.publishedSection}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <section className="grid gap-3 border-t border-[#ddd] pt-6">
          <h2 className="text-xl font-black text-[#444]">Заети секции</h2>
          <p>Секции, взети от друга организация. Колони: секция, организация, място, мир, бележка.</p>
          <input
            className="min-h-11 w-full rounded-xl border border-[#ddd] bg-white px-3"
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV със заети секции"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              void file.text().then((csv) => adminImportTaken({ data: { csv } })).then((result) => {
                if (!result.ok) setMessage(result.message)
                else {
                  setMessage(`Записани са ${result.imported} заети секции.`)
                  load()
                }
              })
            }}
          />
          <ul className="grid gap-2 text-sm">
            {taken.map((row) => (
              <li key={row.section_code}>{row.section_code} · {row.organisation}{row.place ? ` · ${row.place}` : ''}{row.mir_code ? ` · МИР ${row.mir_code}` : ''}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

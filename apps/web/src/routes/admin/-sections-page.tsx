import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { AdminHeading, adminChipOn, adminGhost, adminInput } from '../../components/admin-ui'
import { adminRoster } from '../../signup/admin'
import { adminPublish } from '../../signup/admin-assign-actions'
import { adminDistribute } from '../../signup/admin-distribute'
import { adminNotifyAssignment, adminPublishOne } from '../../signup/assignment-notify'
import type { AssignWarning } from '../../signup/admin-assign'
import type { RosterFields } from '../../signup/admin-csv'
import { TakenSectionsPanel } from './-taken-sections-panel'
import { DeskBadge, SectionPersonRow } from './-section-person-row'
import { useDebouncedQuery } from './-debounced-query'

const sectionsRoute = getRouteApi('/admin/sections')

const views = [
  ['unassigned', 'Без секция'],
  ['draft', 'Чернова'],
  ['assigned', 'Публикувани'],
  ['abroad', 'Чужбина'],
] as const

type Suggestion = { id: string; place: string; score: number; reason: string; desk: 'paper' | 'machine' | 'unknown' }

export function SectionsPage() {
  const search = sectionsRoute.useSearch()
  const navigate = sectionsRoute.useNavigate()
  const access = useAdminAccess()
  const [people, setPeople] = useState<RosterFields[]>([])
  const [taken, setTaken] = useState<Array<{ section_code: string; mir_code: string; place: string; organisation: string }>>([])
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [armed, setArmed] = useState(false)
  const [armedDraft, setArmedDraft] = useState(false)
  const [distributing, setDistributing] = useState(false)
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [rowWarnings, setRowWarnings] = useState<Record<string, AssignWarning[]>>({})
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({})
  const [suggestBusy, setSuggestBusy] = useState<string | null>(null)
  const [mirDraft, setMirDraft] = useState(search.mir)
  const canEdit = access.permissions.edit
  const canPublish = access.permissions.publish

  const commitQuery = useCallback(
    (q: string) => {
      void navigate({ search: (prev) => ({ ...prev, q }), replace: true })
    },
    [navigate],
  )
  const [draft, setDraft] = useDebouncedQuery(search.q, commitQuery)

  function load(notice = '') {
    setArmed(false)
    setArmedDraft(false)
    setPhase('loading')
    void adminRoster({ data: { view: search.view, mir: search.mir, q: search.q, page: 1, limit: 100, sort: 'updated', dir: 'desc', finished: true } }).then((result) => {
      if (!result.ok) {
        setPhase('error')
        setMessage(result.message)
        setPeople([])
        return
      }
      setPhase('ready')
      setMessage(notice)
      setPeople(result.people)
      setTaken(result.taken)
      setDraftValues(Object.fromEntries(result.people.map((person) => [person.id, person.draftSection])))
    }).catch(() => {
      setPhase('error')
      setMessage('Списъкът не се зареди.')
    })
  }

  useEffect(() => {
    setMirDraft(search.mir)
  }, [search.mir])

  useEffect(() => {
    load()
  }, [search.view, search.mir, search.q])

  return (
    <div className="grid gap-5">
      <AdminHeading title="Секции" lede="Тук са само хората, които са завършили записването. „Направи чернови за страната“ слага чернови по избрания обхват, първо в хартиена секция под 300 избиратели. Група се държи на един адрес, после в града, после в общината, после в областта. Мобилният екип и хората, които пътуват в други области, остават за после. Черновата се вижда само тук, докато не я публикуваш." />
      <label className="grid max-w-md gap-1 text-sm font-bold text-[#1a1020]" htmlFor="section-search">
        Търсене
        <input id="section-search" className={adminInput} type="search" value={draft} placeholder="Име, имейл, телефон или ЕГН" onChange={(event) => setDraft(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        {views.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={search.view === id ? adminChipOn : adminGhost}
            aria-pressed={search.view === id}
            onClick={() => void navigate({ search: (prev) => ({ ...prev, view: id }) })}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void navigate({ search: (prev) => ({ ...prev, view: 'mir', mir: mirDraft.trim() }) })
        }}
      >
        <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="section-mir">
          МИР
          <input id="section-mir" className={`${adminInput} w-24`} inputMode="numeric" value={mirDraft} onChange={(event) => setMirDraft(event.target.value)} />
        </label>
        <button className={adminGhost} type="submit">
          Покажи МИР
        </button>
      </form>
      {canEdit ? (
        <button
          type="button"
          className={armedDraft ? 'brand-button w-auto px-6' : adminGhost}
          disabled={distributing}
          onClick={() => {
            if (!armedDraft) {
              setArmedDraft(true)
              return
            }
            setArmedDraft(false)
            setDistributing(true)
            void adminDistribute().then((result) => {
              setDistributing(false)
              setMessage(result.message)
              if (result.ok) load(result.message)
            }).catch(() => {
              setDistributing(false)
              setMessage('Черновите не се записаха. Опитай пак.')
            })
          }}
        >
          {distributing ? 'Смятаме черновите…' : armedDraft ? 'Да, запиши черновите (без публикуване)' : 'Направи чернови за страната'}
        </button>
      ) : null}
      {canPublish ? (
        <button
          type="button"
          className={armed ? 'brand-button w-auto px-6' : adminGhost}
          onClick={() => {
            if (!armed) {
              setArmed(true)
              return
            }
            void adminPublish({ data: { view: search.view, mir: search.mir } }).then((result) => {
              setArmed(false)
              if (!result.ok) setMessage(result.message)
              else {
                const skipped = result.blocked?.length ?? 0
                const notice =
                  skipped > 0
                    ? `Публикувани са ${result.published} чернови. Пропуснати заради заетост/дубликат/МИР: ${skipped}.`
                    : `Публикувани са ${result.published} чернови.`
                setMessage(notice)
                if (result.blocked?.length) {
                  setRowWarnings((current) => {
                    const next = { ...current }
                    for (const item of result.blocked) {
                      const person = people.find((row) => row.email === item.email)
                      if (person) next[person.id] = [{ code: 'taken', level: 'block', message: item.warning }]
                    }
                    return next
                  })
                }
                load(notice)
              }
            })
          }}
        >
          {armed ? 'Да, покажи ги в профилите (без имейл)' : 'Публикувай черновите в този изглед (без имейл)'}
        </button>
      ) : null}
      {phase === 'loading' && people.length === 0 ? <p role="status">Зареждаме секциите…</p> : null}
      {phase === 'error' ? <p role="alert" className="font-bold text-[#8f1d1d]">{message}</p> : null}
      {message && phase !== 'error' ? <p className="text-sm font-bold text-[#1a1020]">{message}</p> : null}
      {phase !== 'loading' && people.length === 0 ? <p className="rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] px-4 py-6">Няма хора за това търсене.</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm text-[#1a1020]" aria-label="Вид секция">
        <span className="font-bold">Вид секция:</span>
        <DeskBadge desk="paper" />
        <DeskBadge desk="machine" />
        <DeskBadge desk="unknown" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm text-[#1a1020]">
          <thead>
            <tr className="border-b-2 border-[#2b062f]">
              <th className="py-2 pr-3 font-black">Човек</th>
              <th className="py-2 pr-3 font-black">Чернова</th>
              <th className="py-2 font-black">Публикувана</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <SectionPersonRow
                key={person.id}
                person={person}
                canEdit={canEdit}
                draftValues={draftValues}
                setDraftValues={setDraftValues}
                warnings={rowWarnings[person.id] ?? []}
                setRowWarnings={setRowWarnings}
                tips={suggestions[person.id] ?? []}
                setSuggestions={setSuggestions}
                suggestBusy={suggestBusy}
                setSuggestBusy={setSuggestBusy}
                setMessage={setMessage}
                load={load}
                canPublish={canPublish}
                publishOne={(id) => adminPublishOne({ data: { id } })}
                notifyAgain={(id) => adminNotifyAssignment({ data: { id } })}
              />
            ))}
          </tbody>
        </table>
      </div>
      <TakenSectionsPanel canEdit={canEdit} taken={taken} setMessage={setMessage} load={load} />
    </div>
  )
}

import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { AdminHeading, adminChipOn, adminGhost, adminInput } from '../../components/admin-ui'
import { adminRoster } from '../../signup/admin'
import { adminSectionPlaces } from '../../signup/admin-section-places'
import { adminPublish } from '../../signup/admin-assign-actions'
import { adminClearDrafts, adminDistribute } from '../../signup/admin-distribute'
import { adminNotifyAssignment, adminPublishOne } from '../../signup/assignment-notify'
import type { AssignWarning } from '../../signup/admin-assign'
import type { RosterFields } from '../../signup/admin-csv'
import type { SectionSpot } from '../../signup/section-where'
import { ReservedSectionsPanel, type ReservedRowView } from './-reserved-sections-panel'
import { loadReservedIndex } from './-reserved-badge'
import { adminReservedSections } from '../../signup/reserved-sections-admin'
import type { ReservationConflict } from '../../signup/reserved-sections'
import { AbroadCoveragePanel } from './-abroad-coverage-panel'
import { AbroadDistributePanel } from './-abroad-distribute-panel'
import { DeskBadge, SectionPersonRow } from './-section-person-row'
import { useDebouncedQuery } from './-debounced-query'
import { BrevoSectionsExportPanel } from './-brevo-sections-export'
import { BrevoSyncPanel } from './-brevo-sync-panel'
import { brevoSectionsScope } from '../../signup/brevo-sections-export'
import { adminPrioritySections, type PrioritySectionView } from '../../signup/priority-sections-admin'
import { orderByPriority, type PriorityCoverage, type PriorityInfo } from '../../signup/priority-sections'
import { PrioritySectionsPanel } from './-priority-sections-panel'

const sectionsRoute = getRouteApi('/admin/sections')

const views = [
  ['unassigned', 'Без секция'],
  ['draft', 'Чернова'],
  ['assigned', 'Публикувани'],
  ['abroad', 'Чужбина'],
] as const

type Suggestion = { id: string; place: string; score: number; reason: string; desk: 'paper' | 'machine' | 'unknown'; priority?: PriorityInfo }

export function SectionsPage() {
  const search = sectionsRoute.useSearch()
  const navigate = sectionsRoute.useNavigate()
  const access = useAdminAccess()
  const [people, setPeople] = useState<RosterFields[]>([])
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [armed, setArmed] = useState(false)
  const [armedDraft, setArmedDraft] = useState(false)
  const [armedEmpty, setArmedEmpty] = useState(false)
  const [armedClear, setArmedClear] = useState(false)
  const [distributing, setDistributing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [rowWarnings, setRowWarnings] = useState<Record<string, AssignWarning[]>>({})
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({})
  const [suggestBusy, setSuggestBusy] = useState<string | null>(null)
  const [spots, setSpots] = useState<Record<string, SectionSpot>>({})
  const [mirDraft, setMirDraft] = useState(search.mir)
  const [reservedRows, setReservedRows] = useState<ReservedRowView[]>([])
  const [reservedOrgs, setReservedOrgs] = useState<Array<{ organisation: string; count: number }>>([])
  const [reservedConflicts, setReservedConflicts] = useState<ReservationConflict[]>([])
  const [prioritySections, setPrioritySections] = useState<PrioritySectionView[]>([])
  const [prioritySummary, setPrioritySummary] = useState<PriorityCoverage | null>(null)
  const [priorityUpdatedAt, setPriorityUpdatedAt] = useState('')
  const canEdit = access.permissions.edit
  const canPublish = access.permissions.publish
  const canExport = access.permissions.exportCampaign
  const brevoScope = brevoSectionsScope(search)

  const commitQuery = useCallback(
    (q: string) => {
      void navigate({ search: (prev) => ({ ...prev, q }), replace: true })
    },
    [navigate],
  )
  const [draft, setDraft] = useDebouncedQuery(search.q, commitQuery)

  function loadPriority(notice = '') {
    void adminPrioritySections().then((result) => {
      if (!result.ok) return
      setPrioritySections(result.sections)
      setPrioritySummary(result.summary)
      setPriorityUpdatedAt(result.updatedAt)
      if (notice) setMessage(notice)
    }).catch(() => {})
  }

  function loadReserved(notice = '') {
    void adminReservedSections().then((result) => {
      if (!result.ok) return
      setReservedRows(result.rows)
      setReservedOrgs(result.orgs)
      setReservedConflicts(result.conflicts)
      void loadReservedIndex(true)
      if (notice) {
        setMessage(notice)
        loadPriority()
      }
    }).catch(() => {})
  }

  const reservedIndex = useMemo(
    () => Object.fromEntries(reservedRows.map((row) => [row.sectionCode, row.organisation])) as Record<string, string>,
    [reservedRows],
  )

  const priorityMap = useMemo(
    () => Object.fromEntries(prioritySections.map((row) => [row.sectionCode, { r: row.r, level: row.level }])) as Record<string, PriorityInfo>,
    [prioritySections],
  )
  const ordered = useMemo(
    () => orderByPriority(people, prioritySections, { only: Boolean(search.prio), sort: Boolean(search.prio) || search.view === 'unassigned' }),
    [people, prioritySections, search.prio, search.view],
  )

  function load(notice = '') {
    loadPriority()
    loadReserved()
    setArmed(false)
    setArmedDraft(false)
    setArmedClear(false)
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

  const watchedCodes = [...new Set(people.flatMap((person) =>
    [person.draftSection, person.publishedSection, draftValues[person.id] ?? '']
      .map((code) => code.replace(/\D/g, ''))
      .filter((code) => code.length === 9),
  ))]
  const watchedTowns = [...new Set(people.flatMap((person) => person.townId ? [person.townId] : []))]
  const placeKey = `${watchedCodes.join(',')};${watchedTowns.join(',')}`

  useEffect(() => {
    const [codePart, townPart] = placeKey.split(';')
    const codes = codePart ? codePart.split(',') : []
    const townIds = townPart ? townPart.split(',').map(Number) : []
    if (codes.length === 0) return
    let cancelled = false
    const handle = setTimeout(() => {
      void adminSectionPlaces({ data: { codes, townIds } }).then((result) => {
        if (!cancelled && result.ok) setSpots(result.places)
      }).catch(() => {})
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [placeKey])

  return (
    <div className="grid gap-5">
      <AdminHeading title="Секции" lede="Тук са само хората, които са завършили записването. „Направи чернови за страната“ слага чернови по избрания обхват, първо в приоритетна секция (в града, после в общината, по R; приоритетна може да е и машинна), после в хартиена секция под 300 избиратели. Машинна секция извън приоритетните не се дава. Резервираните от други организации се пропускат. Група се държи на един адрес, после в града, после в общината, после в областта. Човек, който приема и други области, остава първо в своята. Мобилният екип остава за после. „Запази“ на реда държи тази чернова при следващо пускане. Останалите чернови се смятат наново. „Изчисти черновите“ маха и заключените със „Запази“, за да ги сметнем отначало. Публикуваните секции остават. Черновата се вижда само тук, докато не я публикуваш. „Чернови само за хората без секция“ не пипа никоя съществуваща чернова." />
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
        <button
          type="button"
          className={search.prio ? adminChipOn : adminGhost}
          aria-pressed={Boolean(search.prio)}
          onClick={() => void navigate({ search: (prev) => {
            const { prio: _prio, ...rest } = prev
            return search.prio ? rest : { ...rest, prio: true }
          } })}
        >
          ★ Само приоритетни
        </button>
      </div>
      <PrioritySectionsPanel
        canEdit={canEdit}
        sections={prioritySections}
        summary={prioritySummary}
        updatedAt={priorityUpdatedAt}
        setMessage={setMessage}
        reload={(notice) => loadPriority(notice)}
      />
      <ReservedSectionsPanel
        canEdit={canEdit}
        rows={reservedRows}
        orgs={reservedOrgs}
        conflicts={reservedConflicts}
        setMessage={setMessage}
        reload={(notice) => loadReserved(notice)}
      />
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
      {canExport ? (
        <>
          <BrevoSectionsExportPanel
            filters={{ view: brevoScope.view, mir: brevoScope.mir, q: brevoScope.q }}
            scopeLabel={brevoScope.label}
            setMessage={setMessage}
          />
          <BrevoSyncPanel
            filters={{ view: brevoScope.view, mir: brevoScope.mir, q: brevoScope.q }}
            scopeLabel={brevoScope.label}
            setMessage={setMessage}
          />
        </>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={armedDraft ? 'brand-button w-auto px-6' : adminGhost}
            disabled={distributing || clearing}
            onClick={() => {
              if (!armedDraft) {
                setArmedClear(false)
                setArmedEmpty(false)
                setArmedDraft(true)
                return
              }
              setArmedDraft(false)
              setDistributing(true)
              void adminDistribute({ data: {} }).then((result) => {
                setDistributing(false)
                setMessage(result.message)
                if (result.ok) load(result.message)
              }).catch(() => {
                setDistributing(false)
                setMessage('Черновите не се записаха. Опитай пак.')
              })
            }}
          >
            {distributing ? 'Смятаме черновите…' : armedDraft ? 'Да, запиши черновите (без публикуване, корекциите остават)' : 'Направи чернови за страната'}
          </button>
          <button
            type="button"
            className={armedEmpty ? 'brand-button w-auto px-6' : adminGhost}
            disabled={distributing || clearing}
            onClick={() => {
              if (!armedEmpty) {
                setArmedClear(false)
                setArmedDraft(false)
                setArmedEmpty(true)
                return
              }
              setArmedEmpty(false)
              setDistributing(true)
              void adminDistribute({ data: { onlyEmpty: true } }).then((result) => {
                setDistributing(false)
                setMessage(result.message)
                if (result.ok) load(result.message)
              }).catch(() => {
                setDistributing(false)
                setMessage('Черновите не се записаха. Опитай пак.')
              })
            }}
          >
            {armedEmpty ? 'Да, чернови само за хората без секция (без публикуване)' : 'Чернови само за хората без секция'}
          </button>
          <button
            type="button"
            className={armedClear ? 'brand-button w-auto px-6' : adminGhost}
            disabled={distributing || clearing}
            onClick={() => {
              if (!armedClear) {
                setArmedDraft(false)
                setArmedEmpty(false)
                setArmedClear(true)
                return
              }
              setArmedClear(false)
              setClearing(true)
              void adminClearDrafts().then((result) => {
                setClearing(false)
                setMessage(result.message)
                if (result.ok) load(result.message)
              }).catch(() => {
                setClearing(false)
                setMessage('Черновите не се изчистиха. Опитай пак.')
              })
            }}
          >
            {clearing ? 'Чистим черновите…' : armedClear ? 'Да, изчисти черновите (публикуваните остават)' : 'Изчисти черновите'}
          </button>
        </div>
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
      {phase !== 'loading' && people.length > 0 && ordered.length === 0 ? <p className="rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] px-4 py-6">Няма хора, свързани с приоритетна секция, в този изглед.</p> : null}
      {phase !== 'loading' && people.length === 0 ? <p className="rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] px-4 py-6">Няма хора за това търсене.</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm text-[#1a1020]" aria-label="Вид секция">
        <span className="font-bold">Вид секция:</span>
        <DeskBadge desk="paper" />
        <DeskBadge desk="machine" />
        <DeskBadge desk="unknown" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-left text-sm text-[#1a1020]">
          <thead>
            <tr className="border-b-2 border-[#2b062f]">
              <th className="whitespace-nowrap py-2 pr-3 font-black">Човек</th>
              <th className="whitespace-nowrap py-2 pr-3 font-black">Област</th>
              <th className="whitespace-nowrap py-2 pr-3 font-black">Община</th>
              <th className="whitespace-nowrap py-2 pr-3 font-black">Населено място</th>
              <th className="whitespace-nowrap py-2 pr-3 font-black">Район</th>
              <th className="whitespace-nowrap py-2 pr-3 font-black">Избран адрес</th>
              <th className="whitespace-nowrap py-2 pr-3 font-black">Обхват</th>
              <th className="whitespace-nowrap py-2 pr-3 font-black">Чернова</th>
              <th className="whitespace-nowrap py-2 pr-3 font-black">Къде е секцията</th>
              <th className="whitespace-nowrap py-2 pr-3 font-black">Публикувана</th>
              <th className="whitespace-nowrap py-2 font-black">Къде е публикуваната</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(({ person, reach }) => (
              <SectionPersonRow
                key={person.id}
                person={person}
                priority={priorityMap}
                reserved={reservedIndex}
                reach={reach}
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
                spots={spots}
              />
            ))}
          </tbody>
        </table>
      </div>
      <AbroadCoveragePanel canEdit={canEdit} active={search.view === 'abroad'} setMessage={setMessage} />
      <AbroadDistributePanel
        canEdit={canEdit}
        active={search.view === 'abroad'}
        setMessage={setMessage}
        onSaved={(notice) => load(notice)}
      />
    </div>
  )
}

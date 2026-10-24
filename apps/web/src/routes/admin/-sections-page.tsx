import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { AdminHeading, adminChipOn, adminGhost, adminInput } from '../../components/admin-ui'
import { adminRoster } from '../../signup/admin'
import { adminSectionPlaces } from '../../signup/admin-section-places'
import { adminPublish, adminPublishPreview } from '../../signup/admin-assign-actions'
import { publishConfirmLabel } from '../../signup/publish-preview'
import { adminUnpublish } from '../../signup/section-state-actions'
import { adminPartnerPublish, adminPartnerUnpublish } from '../../signup/partner-sections-admin'
import { isPartnerPersonId } from '../../signup/partner-people-sql'
import { hasPendingDraft, type SectionCounts } from '../../signup/section-state'
import { adminClearDrafts, adminDistribute } from '../../signup/admin-distribute'
import { adminNotifyAssignment } from '../../signup/assignment-notify'
import type { AssignWarning } from '../../signup/admin-assign'
import type { RosterFields } from '../../signup/admin-csv'
import type { SectionSpot } from '../../signup/section-where'
import { ReservedSectionsPanel, type ReservedRowView } from './-reserved-sections-panel'
import { MobileTeamsPanel, useMobileIndex } from './-mobile-teams'
import { PartnerSectionsPanel } from './-partner-sections-panel'
import { loadReservedIndex } from './-reserved-badge'
import { adminReservedSections } from '../../signup/reserved-sections-admin'
import type { ReservationConflict } from '../../signup/reserved-sections'
import { AbroadCoveragePanel } from './-abroad-coverage-panel'
import { AbroadDistributePanel } from './-abroad-distribute-panel'
import { DeskBadge, SectionPersonRow } from './-section-person-row'
import { useDebouncedQuery } from './-debounced-query'
import { BrevoSectionsExportPanel } from './-brevo-sections-export'
import { BrevoSyncPanel } from './-brevo-sync-panel'
import { SectionsPeopleExportPanel } from './-sections-people-export'
import { brevoSectionsScope } from '../../signup/brevo-sections-export'
import { adminPrioritySections, type PrioritySectionView } from '../../signup/priority-sections-admin'
import { orderByPriority, type PriorityCoverage, type PriorityInfo } from '../../signup/priority-sections'
import { PrioritySectionsPanel } from './-priority-sections-panel'

const sectionsRoute = getRouteApi('/admin/sections')

const states = [
  ['', 'Всички', 'total'],
  ['none', 'Без секция', 'none'],
  ['draft', 'Чернова', 'draft'],
  ['published', 'Публикувани', 'published'],
] as const

export function SectionsPage() {
  const search = sectionsRoute.useSearch()
  const navigate = sectionsRoute.useNavigate()
  const access = useAdminAccess()
  const [people, setPeople] = useState<RosterFields[]>([])
  const [counts, setCounts] = useState<SectionCounts | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [armedPicked, setArmedPicked] = useState(false)
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [armed, setArmed] = useState(false)
  const [armedDraft, setArmedDraft] = useState(false)
  const [armedEmpty, setArmedEmpty] = useState(false)
  const [armedClear, setArmedClear] = useState(false)
  const [distributing, setDistributing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [mobileVersion, setMobileVersion] = useState(0)
  const mobileIndex = useMobileIndex(mobileVersion)
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [rowWarnings, setRowWarnings] = useState<Record<string, AssignWarning[]>>({})
  const [spots, setSpots] = useState<Record<string, SectionSpot>>({})
  const [mirDraft, setMirDraft] = useState(search.mir)
  const [reservedRows, setReservedRows] = useState<ReservedRowView[]>([])
  const [reservedOrgs, setReservedOrgs] = useState<Array<{ organisation: string; count: number }>>([])
  const [reservedConflicts, setReservedConflicts] = useState<ReservationConflict[]>([])
  const [prioritySections, setPrioritySections] = useState<PrioritySectionView[]>([])
  const [prioritySummary, setPrioritySummary] = useState<PriorityCoverage | null>(null)
  const [priorityUpdatedAt, setPriorityUpdatedAt] = useState('')
  const [publishPreview, setPublishPreview] = useState<{ volunteers: number; partners: number; message: string } | null>(null)
  const canEdit = access.permissions.edit
  const canPublish = access.permissions.publish
  const canExport = access.permissions.exportCampaign
  const canExportInternal = access.permissions.exportInternal
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
    () => orderByPriority(people, prioritySections, { only: Boolean(search.prio), sort: Boolean(search.prio) || search.state === 'none' }),
    [people, prioritySections, search.prio, search.state],
  )

  function load(notice = '') {
    loadPriority()
    loadReserved()
    setArmed(false)
    setArmedDraft(false)
    setArmedClear(false)
    setArmedPicked(false)
    setPicked(new Set())
    setPhase('loading')
    void adminRoster({ data: { view: search.view, mir: search.mir, q: search.q, state: search.state ?? '', page: 1, limit: 100, sort: 'updated', dir: 'desc', finished: true, partners: true } }).then((result) => {
      if (!result.ok) {
        setPhase('error')
        setMessage(result.message)
        setPeople([])
        return
      }
      setPhase('ready')
      setMessage(notice)
      setPeople(result.people)
      setCounts(result.sectionCounts ?? null)
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
  }, [search.view, search.mir, search.q, search.state])

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

  /** No-email publish: the whole view, or only the picked / one row's ids. */
  async function runPublish(ids?: string[]) {
    // Picked or one row: „И аз“ ids publish through partner_people (no email, no Brevo); never an empty id list.
    const partnerIds = ids ? ids.filter(isPartnerPersonId) : []
    const signupIds = ids ? ids.filter((id) => !isPartnerPersonId(id)) : undefined
    let partnerNote = ''
    if (partnerIds.length > 0) {
      try {
        const result = await adminPartnerPublish({ data: { ids: partnerIds } })
        partnerNote = ` „И аз“: ${result.message}`
        if (result.ok && 'blocked' in result && result.blocked.length) {
          setRowWarnings((current) => {
            const next = { ...current }
            for (const item of result.blocked) next[item.id] = [{ code: 'taken', level: 'block', message: `Секция ${item.section} е заета: ${item.reason}` }]
            return next
          })
        }
      } catch {
        partnerNote = ' „И аз“: публикуването не мина. Опитай пак.'
      }
    }
    if (signupIds && signupIds.length === 0) {
      setArmed(false)
      setArmedPicked(false)
      setPublishPreview(null)
      load(partnerNote.trim())
      return
    }
    return adminPublish({ data: { view: search.view, mir: search.mir, ...(signupIds ? { ids: signupIds } : {}) } }).then((result) => {
      setArmed(false)
      setArmedPicked(false)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setPublishPreview(null)
      const skipped = result.blocked?.length ?? 0
      const partnersPublished = 'partnersPublished' in result ? (result.partnersPublished ?? 0) : 0
      const partnersSkipped = 'partnersBlocked' in result ? (result.partnersBlocked?.length ?? 0) : 0
      const partnerNotice = ids
        ? ''
        : ` „И аз“: публикувани ${partnersPublished}${partnersSkipped ? `, спрени ${partnersSkipped} (заета секция или извън МИР на пълномощното)` : ''}.`
      const notice =
        (skipped > 0
          ? `Публикувани са ${result.published} чернови (без имейл). Пропуснати заради заета секция, дубликат или МИР извън пълномощното: ${skipped}.`
          : `Публикувани са ${result.published} чернови (без имейл).`) + partnerNotice + partnerNote
      load(notice)
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
    }).catch(() => setMessage('Публикуването не мина. Опитай пак.'))
  }

  const pickable = ordered.filter(({ person }) => hasPendingDraft(person)).map(({ person }) => person.id)
  const allPicked = pickable.length > 0 && pickable.every((id) => picked.has(id))
  function togglePick(id: string, on: boolean) {
    setArmedPicked(false)
    setPicked((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div className="grid gap-5">
      <AdminHeading title="Секции" lede="Тук са само хората, които са завършили записването. Всеки е в едно от трите състояния: без секция, с чернова (вижда се само тук) или с публикувана секция (вижда я в профила си). На всеки ред: впиши секция и натисни „Запази“: това е чернова, без публикуване и без имейл; „Публикувай“ я показва в профила, без имейл; „Махни публикуването“ я връща в чернова. Можеш да избереш няколко реда и „Публикувай избраните“. „Направи чернови за страната“ пресмята само автоматичните чернови на хора без публикувана секция: първо приоритетна секция (в града, после в общината, по R), после хартиена под 300 избиратели; резервираните от други организации се пропускат. После мобилните екипи: секция от останалите по същия ред (за пълномощното) и район с приоритетни секции за обикаляне в МИР-а на секцията (виж „Мобилни екипи“); обобщението казва колко са получили и колко са без място. Публикуваните секции и ръчните чернови (запазени със „Запази“ или върнати от публикуване) не се пипат и не се дават на друг. „Чернови само за хората без секция“ не пипа никоя чернова. „Изчисти черновите“ маха само автоматичните чернови; ръчните и публикуваните остават. Чуждите чернови в чужбина не се пипат от разпределението за страната." />
      <label className="grid max-w-md gap-1 text-sm font-bold text-[#1a1020]" htmlFor="section-search">
        Търсене
        <input id="section-search" className={adminInput} type="search" value={draft} placeholder="Име, имейл, телефон или ЕГН" onChange={(event) => setDraft(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Състояние">
        {states.map(([id, label, key]) => {
          const on = (search.state ?? '') === id
          return (
            <button
              key={id || 'all'}
              type="button"
              className={on ? adminChipOn : adminGhost}
              aria-pressed={on}
              data-testid={`state-${id || 'all'}`}
              onClick={() => void navigate({ search: (prev) => {
                const { state: _state, ...rest } = prev
                return id ? { ...rest, state: id } : rest
              } })}
            >
              {label}
              {counts ? <span className="ml-1 font-normal">({counts[key]})</span> : null}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Обхват">
        {([['all', 'Цялата страна'], ['abroad', 'Чужбина']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={search.view === id ? adminChipOn : adminGhost}
            aria-pressed={search.view === id}
            onClick={() => void navigate({ search: (prev) => ({ ...prev, view: id, mir: '' }) })}
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
      <MobileTeamsPanel canEdit={canEdit} setMessage={setMessage} refresh={mobileVersion} />
      <PartnerSectionsPanel canEdit={canEdit} canPublish={canPublish} canRevealEgn={access.permissions.revealEgn} setMessage={setMessage} />
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
      {canExportInternal ? <SectionsPeopleExportPanel setMessage={setMessage} /> : null}
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
                setMobileVersion((value) => value + 1)
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
                setMobileVersion((value) => value + 1)
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
            {clearing ? 'Чистим черновите…' : armedClear ? 'Да, изчисти автоматичните чернови (ръчните и публикуваните остават)' : 'Изчисти черновите'}
          </button>
        </div>
      ) : null}
      {canPublish && picked.size > 0 ? (
        <button
          type="button"
          data-testid="publish-picked"
          className={armedPicked ? 'brand-button w-auto px-6' : adminGhost}
          onClick={() => {
            if (!armedPicked) {
              setArmedPicked(true)
              return
            }
            void runPublish([...picked])
          }}
        >
          {armedPicked ? `Да, публикувай ${picked.size} (без имейл)` : `Публикувай избраните (${picked.size})`}
        </button>
      ) : null}
      {canPublish ? (
        <button
          type="button"
          data-testid="publish-view"
          className={armed ? 'brand-button w-auto px-6' : adminGhost}
          onClick={() => {
            if (!armed) {
              // Count first, so the confirmation says how many volunteers and how many „И аз“ go out.
              void adminPublishPreview({ data: { view: search.view, mir: search.mir } }).then((result) => {
                if (!result.ok) {
                  setMessage(result.message)
                  return
                }
                setPublishPreview({ volunteers: result.volunteers, partners: result.partners, message: result.message })
                setMessage(result.message)
                setArmed(true)
              }).catch(() => setMessage('Не можах да преброя черновите. Опитай пак.'))
              return
            }
            void runPublish()
          }}
        >
          {armed && publishPreview ? publishConfirmLabel(publishPreview) : 'Публикувай черновите в този изглед (без имейл)'}
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
              <th className="py-2 pr-2">
                {canPublish ? (
                  <input
                    type="checkbox"
                    aria-label="Избери всички чернови в изгледа"
                    checked={allPicked}
                    disabled={pickable.length === 0}
                    onChange={(event) => {
                      setArmedPicked(false)
                      setPicked(event.target.checked ? new Set(pickable) : new Set())
                    }}
                  />
                ) : null}
              </th>
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
                mobile={mobileIndex[person.id] ?? null}
                canEdit={canEdit}
                draftValues={draftValues}
                setDraftValues={setDraftValues}
                warnings={rowWarnings[person.id] ?? []}
                setRowWarnings={setRowWarnings}
                setMessage={setMessage}
                load={load}
                canPublish={canPublish}
                picked={picked.has(person.id)}
                onPick={(on) => togglePick(person.id, on)}
                publish={(id) => runPublish([id])}
                unpublish={(id) => (isPartnerPersonId(id) ? adminPartnerUnpublish({ data: { id } }) : adminUnpublish({ data: { id } }))}
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

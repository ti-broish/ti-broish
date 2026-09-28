import { createFileRoute } from '@tanstack/react-router'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { useCallback, useEffect, useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { AdminHeading, adminChipOn, adminGhost, adminInput } from '../../components/admin-ui'
import { adminExport, adminImportPeople, adminResendImports, adminRoster } from '../../signup/admin'
import { parseSignupSearch, type SignupSearch } from '../../signup/admin-search'
import type { RosterFields } from '../../signup/admin-csv'
import { BrevoCampaignPanel } from './-brevo-campaign-panel'
import { useDebouncedQuery } from './-debounced-query'

export const Route = createFileRoute('/admin/signups')({
  validateSearch: (search: Record<string, unknown>): SignupSearch => parseSignupSearch(search),
  component: SignupsPage,
})

const views = [
  ['all', 'Всички'],
  ['assigned', 'Със секция'],
  ['unassigned', 'Без секция'],
  ['abroad', 'Чужбина'],
  ['calls', 'Искат обаждане'],
] as const

const columnHelper = createColumnHelper<RosterFields>()

const columns = [
  columnHelper.accessor((row) => personName(row), {
    id: 'name',
    header: 'Човек',
    cell: (info) => <span className="font-bold">{info.getValue() || '—'}</span>,
  }),
  columnHelper.accessor('email', {
    id: 'email',
    header: 'Имейл',
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor('phone', {
    id: 'phone',
    header: 'Телефон',
    cell: (info) => info.getValue() || '—',
  }),
  columnHelper.accessor((row) => row.mir || (row.region === '32' ? 'Чужбина' : ''), {
    id: 'mir',
    header: 'МИР / място',
    cell: (info) => (
      <div>
        <p>{info.getValue() || '—'}</p>
        <p>{[info.row.original.town, info.row.original.place].filter(Boolean).join(' · ')}</p>
      </div>
    ),
  }),
  columnHelper.accessor('role', {
    id: 'role',
    header: 'Роля',
    cell: (info) => roleText(info.getValue()),
  }),
  columnHelper.display({
    id: 'section',
    header: 'Секция',
    enableSorting: false,
    cell: ({ row }) => <SectionCell person={row.original} />,
  }),
  columnHelper.display({
    id: 'notes',
    header: 'Бележка / обаждане',
    enableSorting: false,
    cell: ({ row }) => <NotesCell person={row.original} />,
  }),
  columnHelper.display({
    id: 'status',
    header: 'Статус',
    enableSorting: false,
    cell: ({ row }) => <StatusChips person={row.original} />,
  }),
]

function SignupsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const access = useAdminAccess()
  const [people, setPeople] = useState<RosterFields[]>([])
  const [total, setTotal] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [links, setLinks] = useState<{ email: string; link: string }[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [mirDraft, setMirDraft] = useState(search.mir)

  const commitQuery = useCallback(
    (q: string) => {
      void navigate({ search: (prev) => ({ ...prev, q, page: 1 }), replace: true })
    },
    [navigate],
  )
  const [draft, setDraft] = useDebouncedQuery(search.q, commitQuery)

  useEffect(() => {
    setMirDraft(search.mir)
  }, [search.mir])

  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    void adminRoster({
      data: { view: search.view, mir: search.mir, q: search.q, page: search.page, sort: search.sort, dir: search.dir, limit: 50 },
    })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setPhase('error')
          setMessage(result.message)
          setPeople([])
          setTotal(0)
          return
        }
        setPhase('ready')
        setMessage('')
        setPeople(result.people)
        setTotal(result.total)
      })
      .catch(() => {
        if (cancelled) return
        setPhase('error')
        setMessage('Списъкът не се зареди.')
      })
    return () => {
      cancelled = true
    }
  }, [search.view, search.mir, search.q, search.page, search.sort, search.dir, reloadKey])

  const sorting: SortingState = [{ id: search.sort, desc: search.dir === 'desc' }]
  const table = useReactTable({
    data: people,
    columns,
    state: { sorting },
    manualSorting: true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(total / 50)),
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      const first = next[0]
      void navigate({
        search: (prev) => ({
          ...prev,
          sort: (first?.id as SignupSearch['sort']) || 'updated',
          dir: first && !first.desc ? 'asc' : 'desc',
          page: 1,
        }),
      })
    },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  })

  const from = total === 0 ? 0 : (search.page - 1) * 50 + 1
  const to = Math.min(total, search.page * 50)
  const canExport = access.permissions.exportCampaign
  const canInternal = access.permissions.exportInternal
  const canEdit = access.permissions.edit

  return (
    <div className="grid gap-5">
      <AdminHeading title="Записвания" lede="Търсене по име, имейл, телефон или ЕГН." />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <label className="grid min-w-0 flex-1 gap-1 text-sm font-bold text-[#1a1020]" htmlFor="signup-search">
          Търсене
          <input
            id="signup-search"
            className={`${adminInput} w-full`}
            type="search"
            value={draft}
            placeholder="Име, имейл, телефон или ЕГН"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void navigate({ search: (prev) => ({ ...prev, view: 'mir', mir: mirDraft.trim(), page: 1 }) })
          }}
        >
          <label className="grid gap-1 text-sm font-bold text-[#1a1020]" htmlFor="signup-mir">
            МИР
            <input id="signup-mir" className={`${adminInput} w-24`} inputMode="numeric" value={mirDraft} onChange={(event) => setMirDraft(event.target.value)} />
          </label>
          <button className={adminGhost} type="submit">
            Покажи МИР
          </button>
        </form>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Изглед">
        {views.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={search.view === id ? adminChipOn : adminGhost}
            aria-pressed={search.view === id}
            onClick={() => {
              void navigate({ search: (prev) => ({ ...prev, view: id, page: 1 }) })
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-sm font-bold text-[#1a1020]" role="status">
        {phase === 'loading' && people.length === 0 ? 'Зареждаме записаните…' : `${total} в този изглед. Показани ${from}–${to}.`}
      </p>
      {phase === 'error' ? (
        <p className="rounded-xl border-2 border-[#8f1d1d] bg-[#fff5f5] px-3 py-2 text-sm font-bold text-[#8f1d1d]" role="alert">
          {message}
        </p>
      ) : null}
      {phase !== 'loading' && people.length === 0 ? (
        <p className="rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] px-4 py-6 text-[#1a1020]">Няма хора за това търсене.</p>
      ) : null}
      <PeopleCards people={people} />
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[880px] border-collapse text-left text-sm text-[#1a1020]">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b-2 border-[#2b062f]">
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  return (
                    <th key={header.id} scope="col" className="py-2 pr-3 font-black" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}>
                      {header.column.getCanSort() ? (
                        <button type="button" className="inline-flex min-h-11 items-center font-black text-[#1a1020]" onClick={header.column.getToggleSortingHandler()}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? ' ↑' : sorted === 'desc' ? ' ↓' : ''}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-[#cfc3d2] align-top">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="py-3 pr-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={adminGhost}
          disabled={search.page <= 1}
          onClick={() => void navigate({ search: (prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }) })}
        >
          Предишна
        </button>
        <span className="text-sm font-bold text-[#1a1020]">
          Страница {search.page} от {Math.max(1, Math.ceil(total / 50))}
        </span>
        <button
          type="button"
          className={adminGhost}
          disabled={search.page * 50 >= total}
          onClick={() => void navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })}
        >
          Следваща
        </button>
      </div>
      <details className="rounded-2xl border-2 border-[#2b062f] bg-white p-4">
        <summary className="cursor-pointer text-base font-black text-[#1a1020]">Инструменти</summary>
        <div className="mt-4 grid gap-4">
          <div className="flex flex-wrap gap-2">
            {canExport ? (
              <button type="button" className={adminGhost} onClick={() => void exportCsv('campaign', search, setMessage)}>
                CSV за Brevo
              </button>
            ) : null}
            {canInternal ? (
              <button type="button" className={adminGhost} onClick={() => void exportCsv('internal', search, setMessage)}>
                CSV за екипа
              </button>
            ) : null}
          </div>
          <BrevoCampaignPanel enabled={canExport} view={search.view} mir={search.mir} setMessage={setMessage} />
          {canEdit ? (
            <section className="grid gap-3">
              <h2 className="text-lg font-black text-[#1a1020]">Хора, въведени от екипа</h2>
              <p className="text-sm text-[#333]">Колони: име, презиме, фамилия, имейл, телефон. До 500 реда.</p>
              <input
                className={`${adminInput} w-full`}
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
                    setReloadKey((key) => key + 1)
                  })
                }}
              />
              <button
                type="button"
                className={adminGhost}
                onClick={() =>
                  void adminResendImports({ data: { limit: 100 } }).then((result) => {
                    if (!result.ok) setMessage(result.message)
                    else {
                      setLinks(result.links)
                      setMessage(`Писма: ${result.mailed} от ${result.pending}.`)
                    }
                  })
                }
              >
                Изпрати чакащите писма
              </button>
              {links.length > 0 ? (
                <ul className="grid gap-2 text-sm text-[#1a1020]">
                  {links.map((item) => (
                    <li key={item.email}>
                      {item.email} · <a href={item.link}>{item.link}</a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {message && phase !== 'error' ? <p className="text-sm font-bold text-[#1a1020]">{message}</p> : null}
            </section>
          ) : null}
        </div>
      </details>
    </div>
  )
}

function PeopleCards({ people }: { people: RosterFields[] }) {
  if (people.length === 0) return null
  return (
    <ul className="grid gap-3 md:hidden">
      {people.map((person) => (
        <li key={person.id} className="grid gap-1 rounded-2xl border-2 border-[#2b062f] p-4 text-sm text-[#1a1020]">
          <p className="text-base font-black">{personName(person) || '—'}</p>
          <p>{person.email}</p>
          <p>{person.phone || '—'}</p>
          <p>
            {person.mir || (person.region === '32' ? 'Чужбина' : '—')}
            {[person.town, person.place].filter(Boolean).length ? ` · ${[person.town, person.place].filter(Boolean).join(' · ')}` : ''}
          </p>
          <p>{roleText(person.role)}</p>
          <SectionCell person={person} />
          <NotesCell person={person} />
          <StatusChips person={person} />
        </li>
      ))}
    </ul>
  )
}

function SectionCell({ person }: { person: RosterFields }) {
  if (!person.publishedSection && !person.draftSection) return <p>—</p>
  return (
    <div>
      {person.publishedSection ? <p>Публ. {person.publishedSection}</p> : null}
      {person.draftSection && person.draftSection !== person.publishedSection ? <p>Чернова {person.draftSection}</p> : null}
    </div>
  )
}

function NotesCell({ person }: { person: RosterFields }) {
  if (!person.callRequestedAt && !person.notes) return <p>—</p>
  return (
    <div>
      {person.callRequestedAt ? <p className="font-bold">Иска обаждане{person.callMessage ? `: ${person.callMessage}` : ''}</p> : null}
      {person.notes ? <p className="whitespace-pre-wrap">{person.notes}</p> : null}
    </div>
  )
}

function StatusChips({ person }: { person: RosterFields }) {
  const chips: Array<{ label: string; className: string }> = []
  if (person.withdrawn) chips.push({ label: 'Оттеглен', className: 'bg-[#3a3140] text-white' })
  else if (person.publishedSection) chips.push({ label: 'Публикувана', className: 'bg-[#145744] text-white' })
  else if (person.draftSection) chips.push({ label: 'Чернова', className: 'bg-[#2b062f] text-white' })
  else chips.push({ label: 'Без секция', className: 'bg-[#efe8f2] text-[#1a1020]' })
  if (person.callRequestedAt) chips.push({ label: 'Обаждане', className: 'bg-[#7a1f4b] text-white' })
  if (person.imported && !person.emailConfirmed) chips.push({ label: 'Чака имейл', className: 'bg-[#efe8f2] text-[#1a1020]' })
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span key={chip.label} className={`inline-flex min-h-7 items-center rounded-full px-2 text-xs font-bold ${chip.className}`}>
          {chip.label}
        </span>
      ))}
    </div>
  )
}

function personName(person: RosterFields) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ')
}

function roleText(role: string) {
  if (role === 'mobile') return 'Мобилен екип'
  if (role === 'video') return 'Видеонаблюдение'
  if (role === 'section') return 'Секция'
  return role || '—'
}

function exportCsv(kind: 'campaign' | 'internal', search: SignupSearch, setMessage: (message: string) => void) {
  return adminExport({ data: { view: search.view, mir: search.mir, kind, q: search.q } }).then((result) => {
    if (!result.ok) setMessage(result.message)
    else download(result.filename, result.csv)
  })
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

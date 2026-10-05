import { Link, createFileRoute } from '@tanstack/react-router'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type SortingState } from '@tanstack/react-table'
import { useCallback, useEffect, useState } from 'react'
import { useAdminAccess } from '../../components/AdminShell'
import { AdminHeading, adminChipOn, adminGhost, adminInput } from '../../components/admin-ui'
import { adminRoster } from '../../signup/admin'
import type { RosterFields } from '../../signup/admin-csv'
import { daysLabel, formatStaffWhen } from '../../signup/admin-progress'
import { parseQueueSearch, type QueueSearch } from '../../signup/admin-search'
import { toggleSelected } from '../../signup/admin-bulk'
import { BulkCallbackBar, SelectPerson } from './-bulk-callback'
import { useDebouncedQuery } from './-debounced-query'

export const Route = createFileRoute('/admin/calls')({
  validateSearch: (search: Record<string, unknown>): QueueSearch => parseQueueSearch(search),
  component: CallsPage,
})

const shows = [
  ['open', 'За обаждане'],
  ['all', 'Всички поискали'],
] as const

const sorts = [
  ['flagged', 'Наскоро'],
  ['days', 'По дни'],
  ['name', 'Име'],
] as const

const columnHelper = createColumnHelper<RosterFields>()

function CallsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const access = useAdminAccess()
  const [people, setPeople] = useState<RosterFields[]>([])
  const [total, setTotal] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [note, setNote] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [wholeView, setWholeView] = useState(false)
  const canEdit = access.permissions.edit

  const commitQuery = useCallback(
    (q: string) => {
      void navigate({ search: (prev) => ({ ...prev, q, page: 1 }), replace: true })
    },
    [navigate],
  )
  const [draft, setDraft] = useDebouncedQuery(search.q, commitQuery)

  useEffect(() => {
    setSelected(new Set())
    setWholeView(false)
    setNote('')
  }, [search.show, search.q, search.sort, search.dir])

  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    void adminRoster({
      data: {
        view: search.show === 'open' ? 'queue' : 'calls',
        q: search.q,
        page: search.page,
        sort: search.sort,
        dir: search.dir,
        limit: 50,
      },
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
        setMessage('Опашката не се зареди.')
      })
    return () => {
      cancelled = true
    }
  }, [search.show, search.q, search.page, search.sort, search.dir, reloadKey])

  const pageAll = people.length > 0 && (wholeView || people.every((person) => selected.has(person.id)))
  const select = canEdit
    ? {
        pageAll,
        checked: (id: string) => wholeView || selected.has(id),
        onPage: (on: boolean) => {
          setWholeView(false)
          setSelected(on ? new Set(people.map((person) => person.id)) : new Set())
        },
        onRow: (id: string, on: boolean) => {
          if (wholeView && !on) {
            setWholeView(false)
            setSelected(new Set(people.map((person) => person.id).filter((item) => item !== id)))
            return
          }
          setSelected((current) => toggleSelected(current, id, on))
        },
      }
    : null

  const sorting: SortingState = [{ id: search.sort, desc: search.dir === 'desc' }]
  const table = useReactTable({
    data: people,
    columns: queueColumns(select),
    state: { sorting },
    manualSorting: true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(total / 50)),
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  })
  const from = total === 0 ? 0 : (search.page - 1) * 50 + 1
  const to = Math.min(total, search.page * 50)

  return (
    <div className="grid gap-5">
      <AdminHeading
        title="Обаждания"
        lede="Само хора, които са поискали разговор. Бележката на екипа е на реда. Отбелязаното обаждане маха човека от „За обаждане“."
      />
      <label className="grid max-w-xl gap-1 text-sm font-bold text-[#1a1020]" htmlFor="queue-search">
        Търсене
        <input
          id="queue-search"
          className={`${adminInput} w-full`}
          type="search"
          value={draft}
          placeholder="Име, имейл или телефон"
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Кого показваме">
        {shows.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={search.show === id ? adminChipOn : adminGhost}
            aria-pressed={search.show === id}
            onClick={() => void navigate({ search: (prev) => ({ ...prev, show: id, page: 1 }) })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Подредба">
        {sorts.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={search.sort === id ? adminChipOn : adminGhost}
            aria-pressed={search.sort === id}
            onClick={() =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  sort: id,
                  dir: prev.sort === id && prev.dir === 'desc' ? 'asc' : 'desc',
                  page: 1,
                }),
              })
            }
          >
            {label}
            {search.sort === id ? (search.dir === 'asc' ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
      </div>
      <p className="text-sm font-bold text-[#1a1020]" role="status">
        {phase === 'loading' && people.length === 0 ? 'Зареждаме обажданията…' : `${total} в този изглед. Показани ${from}–${to}.`}
      </p>
      {canEdit && (people.length > 0 || wholeView) ? (
        <BulkCallbackBar
          total={total}
          visibleCount={people.length}
          selectedCount={selected.size}
          wholeView={wholeView}
          onWholeView={() => setWholeView((current) => !current)}
          view={search.show === 'open' ? 'queue' : 'calls'}
          mir=""
          q={search.q}
          ids={[...selected]}
          onApplied={(next) => {
            setNote(next)
            setSelected(new Set())
            setWholeView(false)
            setReloadKey((key) => key + 1)
          }}
        />
      ) : null}
      {note ? <p className="text-sm font-bold text-[#145744]" role="status">{note}</p> : null}
      {phase === 'error' ? (
        <p className="rounded-xl border-2 border-[#8f1d1d] bg-[#fff5f5] px-3 py-2 text-sm font-bold text-[#8f1d1d]" role="alert">
          {message}
        </p>
      ) : null}
      {phase !== 'loading' && people.length === 0 ? (
        <p className="rounded-2xl border-2 border-[#2b062f] bg-[#f6f1f7] px-4 py-6 text-[#1a1020]">Няма хора за обаждане в този изглед.</p>
      ) : null}
      <QueueCards people={people} select={select} />
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[880px] border-collapse text-left text-sm text-[#1a1020]">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b-2 border-[#2b062f]">
                {group.headers.map((header) => (
                  <th key={header.id} scope="col" className="py-2 pr-3 font-black">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
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
        <button type="button" className={adminGhost} disabled={search.page <= 1} onClick={() => void navigate({ search: (prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }) })}>
          Предишна
        </button>
        <span className="text-sm font-bold text-[#1a1020]">
          Страница {search.page} от {Math.max(1, Math.ceil(total / 50))}
        </span>
        <button type="button" className={adminGhost} disabled={search.page * 50 >= total} onClick={() => void navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })}>
          Следваща
        </button>
      </div>
    </div>
  )
}

interface RowSelect {
  pageAll: boolean
  checked: (id: string) => boolean
  onPage: (on: boolean) => void
  onRow: (id: string, on: boolean) => void
}

function queueColumns(select: RowSelect | null) {
  const leading = select
    ? [
        columnHelper.display({
          id: 'select',
          header: () => <input type="checkbox" className="h-5 w-5" checked={select.pageAll} aria-label="Избери тази страница" onChange={(event) => select.onPage(event.target.checked)} />,
          cell: ({ row }) => (
            <SelectPerson name={personName(row.original)} checked={select.checked(row.original.id)} onChange={(on) => select.onRow(row.original.id, on)} />
          ),
        }),
      ]
    : []
  return [
    ...leading,
    columnHelper.accessor((row) => personName(row), {
      id: 'name',
      header: 'Човек',
      cell: (info) => (
        <Link to="/admin/signups/$personId" params={{ personId: info.row.original.id }} className="font-bold text-[#2b062f] underline">
          {info.getValue() || '—'}
        </Link>
      ),
    }),
    columnHelper.accessor('email', { header: 'Имейл', cell: (info) => info.getValue() || '—' }),
    columnHelper.accessor('phone', { header: 'Телефон', cell: (info) => info.getValue() || '—' }),
    columnHelper.display({
      id: 'days',
      header: 'Дни',
      cell: ({ row }) => daysLabel(row.original.roundsFirst === true, row.original.roundsRunoff === true),
    }),
    columnHelper.display({
      id: 'staffNote',
      header: 'Бележка от екипа',
      cell: ({ row }) =>
        row.original.staffNote ? <p className="line-clamp-3 whitespace-pre-wrap">{row.original.staffNote}</p> : <p>—</p>,
    }),
    columnHelper.display({
      id: 'flagged',
      header: 'Поискано',
      cell: ({ row }) => (
        <div>
          <p>{row.original.callRequestedAt ? formatStaffWhen(row.original.callRequestedAt) : '—'}</p>
          {row.original.callMessage ? <p className="line-clamp-2">{row.original.callMessage}</p> : null}
        </div>
      ),
    }),
    columnHelper.display({
      id: 'called',
      header: 'Обаждане',
      cell: ({ row }) =>
        row.original.staffCalledAt ? (
          <span className="inline-flex min-h-7 items-center rounded-full bg-[#1f4d7a] px-2 text-xs font-bold text-white">Обадени сме</span>
        ) : (
          <span className="inline-flex min-h-7 items-center rounded-full bg-[#7a1f4b] px-2 text-xs font-bold text-white">За обаждане</span>
        ),
    }),
  ]
}

function QueueCards({ people, select }: { people: RosterFields[]; select: RowSelect | null }) {
  if (people.length === 0) return null
  return (
    <ul className="grid gap-3 md:hidden">
      {people.map((person) => (
        <li key={person.id} className="grid gap-1 rounded-2xl border-2 border-[#2b062f] p-4 text-sm text-[#1a1020]">
          {select ? <SelectPerson name={personName(person)} checked={select.checked(person.id)} onChange={(on) => select.onRow(person.id, on)} /> : null}
          <Link to="/admin/signups/$personId" params={{ personId: person.id }} className="text-base font-black text-[#2b062f] underline">
            {personName(person) || '—'}
          </Link>
          <p>{person.email || '—'}</p>
          <p>{person.phone || '—'}</p>
          <p>{daysLabel(person.roundsFirst === true, person.roundsRunoff === true)}</p>
          <p className="whitespace-pre-wrap">{person.staffNote || '—'}</p>
          <p>{person.callRequestedAt ? formatStaffWhen(person.callRequestedAt) : '—'}</p>
        </li>
      ))}
    </ul>
  )
}

function personName(person: RosterFields) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ')
}

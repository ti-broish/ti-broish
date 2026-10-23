import { Link, createFileRoute } from '@tanstack/react-router'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AdminHeading, adminChipOn, adminGhost, adminInput } from '../../components/admin-ui'
import { formatStaffWhen } from '../../signup/admin-progress'
import { rikOverview, rikPeople, rikSyncNow, rikTaskDone, rikTasks, type RikPersonRow, type RikSourceRow, type RikTaskRow } from '../../signup/rik-admin'
import { STATUS_LABELS, TASK_LABELS, type RikStatus, type RikTaskType } from '../../signup/rik/match'
import { parseRikSearch, type RikSearch } from '../../signup/rik/search'
import { useDebouncedQuery } from './-debounced-query'
import { IdentityFixForm } from '../../components/IdentityFixForm'

export const Route = createFileRoute('/admin/rik')({
  validateSearch: (search: Record<string, unknown>): RikSearch => parseRikSearch(search),
  component: RikPage,
})

const views = [
  ['summary', 'По МИР'],
  ['people', 'Хора'],
  ['tasks', 'Задачи'],
] as const

const HEALTH_LABELS: Record<string, string> = {
  ok: 'Чете се',
  empty: 'Още празен',
  not_published: 'Няма регистър',
  warning: 'Предупреждение',
  blocked: 'Блокиран от сайта',
  error: 'Грешка',
  unrecognised: 'Непознат вид',
  never: 'Не е четен',
}

/** Warning: one failed run, the last good read still counts. Error: failed ERROR_AFTER_FAILURES runs in a row. */
const HEALTH_TONE: Record<string, string | undefined> = {
  ok: 'bg-[#145744] text-white',
  warning: 'bg-[#fff4d6] text-[#6b4a00] border border-[#b07d00]',
  blocked: 'bg-[#3d3d3d] text-white',
  error: undefined,
  unrecognised: undefined,
}
const NEUTRAL_TONE = 'bg-[#f6f1f7] text-[#2b062f] border border-[#2b062f]'

const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'тече',
  ok: 'успешно',
  partial: 'с пропуски',
  failed: 'неуспешно',
  missed: 'пропуснато',
}

const STATUS_TONE: Partial<Record<RikStatus, string>> = {
  registered: 'bg-[#145744] text-white',
  pending: 'bg-[#f6f1f7] text-[#2b062f] border border-[#2b062f]',
  not_signed: 'bg-white text-[#5c5160] border border-[#cfc3d2]',
  withdrawn: 'bg-white text-[#5c5160] border border-[#cfc3d2]',
}

function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-bold ${tone ?? 'bg-[#7a1f4b] text-white'}`}>{children}</span>
}

function when(at: string | null | undefined) {
  return at ? formatStaffWhen(at) : '—'
}

type Overview = Extract<Awaited<ReturnType<typeof rikOverview>>, { ok: true }>

function RikPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState('')
  const [note, setNote] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void rikOverview()
      .then((result) => {
        if (cancelled) return
        if (!result.ok) setError(result.message)
        else {
          setOverview(result)
          setError('')
        }
      })
      .catch(() => !cancelled && setError('Прегледът не се зареди.'))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const sync = (mir: string) => {
    setSyncing(mir || 'all')
    setNote('')
    void rikSyncNow({ data: { mir } })
      .then((result) => {
        if (!result.ok) setNote(result.message)
        else {
          const s = result.summary
          setNote(`Прочетени ${s.fetched} страници, ${s.changed} променени, ${s.errors} РИК с грешка.`)
        }
        setReloadKey((key) => key + 1)
      })
      .catch(() => setNote('Синхронизацията не мина. Опитай пак.'))
      .finally(() => setSyncing(''))
  }

  const setSearch = (patch: Partial<RikSearch>) => void navigate({ search: (prev) => ({ ...prev, page: 1, ...patch }) })
  const totalPeople = overview ? Object.entries(overview.statuses).filter(([status]) => status !== 'withdrawn' && status !== 'duplicate').reduce((sum, [, n]) => sum + n, 0) : 0

  return (
    <div className="grid gap-5" data-testid="rik-page">
      <AdminHeading
        title="РИК"
        lede="Кой от хората с пълномощно е публикуван в регистъра на представителите на своя РИК. Регистрите се четат автоматично на всеки час; задачите се правят сами, а махане на човек става само ръчно."
      />
      {error ? (
        <p className="rounded-xl border-2 border-[#8f1d1d] bg-[#fff5f5] px-3 py-2 text-sm font-bold text-[#8f1d1d]" role="alert">
          {error}
        </p>
      ) : null}
      {overview ? (
        <section className="grid gap-2" aria-label="Обобщение">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="bg-[#2b062f] text-white">{totalPeople} с пълномощно</Badge>
            {(Object.keys(STATUS_LABELS) as RikStatus[])
              .filter((status) => overview.statuses[status])
              .map((status) => (
                <button key={status} type="button" className="contents" onClick={() => setSearch({ view: 'people', status })}>
                  <Badge tone={STATUS_TONE[status]}>
                    {STATUS_LABELS[status]}: {overview.statuses[status]}
                  </Badge>
                </button>
              ))}
          </div>
          <div className="flex flex-wrap gap-2 text-sm" data-testid="rik-task-counts">
            {(Object.keys(TASK_LABELS) as RikTaskType[]).map((type) => (
              <button key={type} type="button" className="contents" onClick={() => setSearch({ view: 'tasks', type, show: 'open' })}>
                <Badge tone="bg-white text-[#2b062f] border-2 border-[#2b062f]">
                  {TASK_LABELS[type]}: {overview.taskTypes[type] ?? 0}
                </Badge>
              </button>
            ))}
          </div>
          <p className="text-sm text-[#333]">
            Последно пускане: {overview.lastRun ? `${when(overview.lastRun.startedAt)} (${overview.lastRun.trigger === 'cron' ? 'автоматично' : 'ръчно'}, ${overview.lastRun.fetched} страници${overview.lastRun.errors ? `, ${overview.lastRun.errors} РИК с грешка` : ''}${RUN_STATUS_LABELS[overview.lastRun.status] ? `, ${RUN_STATUS_LABELS[overview.lastRun.status]}` : ''})` : 'още няма'}
            {overview.lastRun?.status === 'failed' || overview.lastRun?.status === 'missed' ? <span className="block font-bold text-[#8f1d1d]">{overview.lastRun.note}</span> : null}
          </p>
          {(() => {
            const warnings = overview.sources.filter((source) => source.health === 'warning')
            const errors = overview.sources.filter((source) => source.health === 'error' || source.health === 'unrecognised')
            const blocked = overview.sources.filter((source) => source.health === 'blocked')
            if (!warnings.length && !errors.length && !blocked.length) return null
            return (
              <div className="flex flex-wrap gap-2 text-sm" data-testid="rik-source-health">
                {errors.length ? (
                  <Badge>
                    Грешка (РИК не се чете 2+ пъти подред): {errors.map((source) => source.mir).join(', ')}
                  </Badge>
                ) : null}
                {blocked.length ? (
                  <Badge tone={HEALTH_TONE.blocked}>Блокиран от сайта (данните и задачите стоят както бяха): {blocked.map((source) => source.mir).join(', ')}</Badge>
                ) : null}
                {warnings.length ? (
                  <Badge tone={HEALTH_TONE.warning}>Предупреждение (1 неуспешно четене, важат последните данни): {warnings.map((source) => source.mir).join(', ')}</Badge>
                ) : null}
              </div>
            )
          })()}
          {overview.canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={adminGhost} disabled={syncing !== ''} onClick={() => sync('')}>
                {syncing === 'all' ? 'Чете регистрите…' : 'Синхронизирай всички РИК'}
              </button>
              {note ? (
                <span className="text-sm font-bold text-[#145744]" role="status">
                  {note}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Изглед">
        {views.map(([id, label]) => (
          <button key={id} type="button" className={search.view === id ? adminChipOn : adminGhost} aria-pressed={search.view === id} onClick={() => setSearch({ view: id })}>
            {label}
          </button>
        ))}
      </div>
      <MirFilter value={search.mir} onChange={(mir) => setSearch({ mir })} />
      {search.view === 'summary' ? (
        <SummaryTable rows={overview?.sources ?? []} mir={search.mir} canEdit={overview?.canEdit ?? false} syncing={syncing} onSync={sync} onPick={(mir, status) => setSearch({ view: 'people', mir, status })} />
      ) : null}
      {search.view === 'people' ? <PeopleView search={search} setSearch={setSearch} reloadKey={reloadKey} /> : null}
      {search.view === 'tasks' ? <TasksView search={search} setSearch={setSearch} reloadKey={reloadKey} onChanged={() => setReloadKey((key) => key + 1)} /> : null}
    </div>
  )
}

function MirFilter({ value, onChange }: { value: string; onChange: (mir: string) => void }) {
  return (
    <label className="grid max-w-xs gap-1 text-sm font-bold text-[#1a1020]" htmlFor="rik-mir">
      МИР
      <select id="rik-mir" className={`${adminInput} w-full`} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Всички</option>
        {Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(2, '0')).map((mir) => (
          <option key={mir} value={mir}>
            {mir}
          </option>
        ))}
      </select>
    </label>
  )
}

function DataTable<T>({ data, columns, rowId, minWidth = 880 }: { data: T[]; columns: ColumnDef<T, any>[]; rowId: (row: T) => string; minWidth?: number }) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getRowId: rowId })
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm text-[#1a1020]" style={{ minWidth }}>
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
  )
}

const sourceColumns = createColumnHelper<RikSourceRow>()

function SummaryTable({
  rows,
  mir,
  canEdit,
  syncing,
  onSync,
  onPick,
}: {
  rows: RikSourceRow[]
  mir: string
  canEdit: boolean
  syncing: string
  onSync: (mir: string) => void
  onPick: (mir: string, status: string) => void
}) {
  const shown = mir ? rows.filter((row) => row.mir === mir) : rows
  const columns = [
    sourceColumns.accessor('mir', {
      header: 'МИР',
      cell: (info) => (
        <span className="font-bold">
          {info.getValue()} {info.row.original.label}
        </span>
      ),
    }),
    sourceColumns.accessor('people', {
      header: 'С пълномощно',
      cell: (info) => (
        <button type="button" className="font-bold underline" onClick={() => onPick(info.row.original.mir, '')}>
          {info.getValue()}
        </button>
      ),
    }),
    sourceColumns.accessor('registered', { header: 'Регистрирани', cell: (info) => <button type="button" className="underline" onClick={() => onPick(info.row.original.mir, 'registered')}>{info.getValue()}</button> }),
    sourceColumns.accessor('waiting', { header: 'Чакат', cell: (info) => info.getValue() }),
    sourceColumns.accessor('problems', { header: 'Проблеми', cell: (info) => <button type="button" className="underline" onClick={() => onPick(info.row.original.mir, 'problems')}>{info.getValue()}</button> }),
    sourceColumns.accessor('openTasks', { header: 'Задачи', cell: (info) => info.getValue() }),
    sourceColumns.display({
      id: 'register',
      header: 'Регистър',
      cell: ({ row }) => (
        <div className="grid gap-1">
          <Badge tone={row.original.health in HEALTH_TONE ? HEALTH_TONE[row.original.health] : NEUTRAL_TONE}>
            {HEALTH_LABELS[row.original.health] ?? row.original.health}
            {row.original.failures > 0 && (row.original.health === 'warning' || row.original.health === 'error') ? ` · ${row.original.failures}× подред` : ''}
          </Badge>
          <span className="text-xs">
            Наши редове: {row.original.ourEntries} · страници: {row.original.pages}
            {row.original.otherMatches ? ` · при други: ${row.original.otherMatches}` : ''}
          </span>
          {row.original.lastError ? (
            <span className={`text-xs ${row.original.health === 'warning' ? 'text-[#6b4a00]' : 'text-[#8f1d1d]'}`}>
              {row.original.health === 'warning' ? 'Последният опит не мина, важат данните от последното успешно четене: ' : ''}
              {row.original.lastError}
            </span>
          ) : null}
          {row.original.blockedUntil && Date.parse(row.original.blockedUntil) > Date.now() ? (
            <span className="text-xs text-[#3d3d3d]">Не го четем до {when(row.original.blockedUntil)}; важат последните данни.</span>
          ) : null}
          {row.original.registerUrl ? (
            <a className="text-xs underline" href={row.original.registerUrl} target="_blank" rel="noreferrer">
              Отвори регистъра
            </a>
          ) : null}
        </div>
      ),
    }),
    sourceColumns.display({
      id: 'synced',
      header: 'Последно четене',
      cell: ({ row }) => (
        <div className="grid gap-1 text-xs">
          <span>Успешно: {when(row.original.lastSuccessAt)}</span>
          <span>Промяна: {when(row.original.lastChangeAt)}</span>
          <span className="text-[#5c5160]">{row.original.adapter}</span>
          {canEdit ? (
            <button type="button" className="w-fit underline" disabled={syncing !== ''} onClick={() => onSync(row.original.mir)}>
              {syncing === row.original.mir ? 'Чете…' : 'Прочети сега'}
            </button>
          ) : null}
        </div>
      ),
    }),
    sourceColumns.accessor('phones', { header: 'Телефон на РИК', cell: (info) => <span className="text-xs">{info.getValue() || '—'}</span> }),
  ]
  return <DataTable data={shown} columns={columns} rowId={(row) => row.mir} minWidth={1100} />
}

const personColumns = createColumnHelper<RikPersonRow>()

function PeopleView({ search, setSearch, reloadKey }: { search: RikSearch; setSearch: (patch: Partial<RikSearch>) => void; reloadKey: number }) {
  const [people, setPeople] = useState<RikPersonRow[]>([])
  const [total, setTotal] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const commit = useCallback((q: string) => setSearch({ q }), [setSearch])
  const [draft, setDraft] = useDebouncedQuery(search.q, commit)

  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    void rikPeople({ data: { mir: search.mir, status: search.status, q: search.q, page: search.page } })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) return setPhase('error')
        setPeople(result.people)
        setTotal(result.total)
        setPhase('ready')
      })
      .catch(() => !cancelled && setPhase('error'))
    return () => {
      cancelled = true
    }
  }, [search.mir, search.status, search.q, search.page, reloadKey])

  const columns = [
    personColumns.accessor('name', {
      header: 'Човек',
      cell: (info) =>
        info.row.original.source === 'signup' ? (
          <Link to="/admin/signups/$personId" params={{ personId: info.row.original.id }} className="font-bold text-[#2b062f] underline">
            {info.getValue() || '—'}
          </Link>
        ) : (
          <span className="font-bold">
            {info.getValue() || '—'} <span className="text-xs font-medium">(„И аз“)</span>
          </span>
        ),
    }),
    personColumns.accessor('mir', { header: 'МИР', cell: (info) => info.getValue() }),
    personColumns.accessor('number', { header: 'Пълномощно', cell: (info) => (info.getValue() == null ? '—' : `${info.getValue()}/${info.row.original.issuedOn}`) }),
    personColumns.accessor('status', {
      header: 'Статус',
      cell: (info) => (
        <div className="grid gap-1">
          <Badge tone={STATUS_TONE[info.getValue()]}>{info.row.original.statusLabel}</Badge>
          <span className="text-xs">от {when(info.row.original.statusSince)}</span>
        </div>
      ),
    }),
    personColumns.display({
      id: 'rik',
      header: 'В регистъра',
      cell: ({ row }) => (
        <div className="grid gap-1 text-xs">
          {row.original.rikName ? (
            <span>
              {row.original.rikName} · {row.original.rikNumber || '—'}
            </span>
          ) : (
            <span>—</span>
          )}
          {row.original.otherParty ? <span>За: {row.original.otherParty}</span> : null}
          {row.original.otherMir ? <span>РИК {row.original.otherMir}</span> : null}
          {row.original.detail && row.original.detail !== row.original.rikName ? <span>{row.original.detail}</span> : null}
          {row.original.sourceUrl ? (
            <a className="underline" href={row.original.sourceUrl} target="_blank" rel="noreferrer">
              Източник
            </a>
          ) : null}
        </div>
      ),
    }),
    personColumns.accessor('tasks', {
      header: 'Задачи',
      cell: (info) =>
        info.getValue() ? (
          <button type="button" className="underline" onClick={() => setSearch({ view: 'tasks', mir: info.row.original.mir, show: 'open' })}>
            {info.getValue()}
          </button>
        ) : (
          '—'
        ),
    }),
  ]

  return (
    <section className="grid gap-3" aria-label="Хора">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-64 gap-1 text-sm font-bold" htmlFor="rik-q">
          Търсене
          <input id="rik-q" type="search" className={`${adminInput} w-full`} value={draft} placeholder="Име или номер" onChange={(event) => setDraft(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-bold" htmlFor="rik-status">
          Статус
          <select id="rik-status" className={adminInput} value={search.status} onChange={(event) => setSearch({ status: event.target.value })}>
            <option value="">Всички (без отписани и дубликати)</option>
            <option value="problems">Само проблеми</option>
            {(Object.keys(STATUS_LABELS) as RikStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-sm font-bold" role="status">
        {phase === 'loading' ? 'Зареждаме…' : phase === 'error' ? 'Списъкът не се зареди.' : `${total} души.`}
      </p>
      <DataTable data={people} columns={columns} rowId={(row) => row.id} />
      <Pager page={search.page} total={total} onPage={(page) => setSearch({ page })} />
    </section>
  )
}

const taskColumns = createColumnHelper<RikTaskRow>()

function TasksView({
  search,
  setSearch,
  reloadKey,
  onChanged,
}: {
  search: RikSearch
  setSearch: (patch: Partial<RikSearch>) => void
  reloadKey: number
  onChanged: () => void
}) {
  const [tasks, setTasks] = useState<RikTaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [canEdit, setCanEdit] = useState(false)
  const [canFix, setCanFix] = useState(false)
  const [fixing, setFixing] = useState('')
  const [fixNote, setFixNote] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    void rikTasks({ data: { mir: search.mir, type: search.type, show: search.show, page: search.page } })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) return setPhase('error')
        setTasks(result.tasks)
        setTotal(result.total)
        setCanEdit(result.canEdit)
        setCanFix(result.canFix)
        setPhase('ready')
      })
      .catch(() => !cancelled && setPhase('error'))
    return () => {
      cancelled = true
    }
  }, [search.mir, search.type, search.show, search.page, reloadKey])

  const toggle = (task: RikTaskRow) => {
    setBusy(task.id)
    void rikTaskDone({ data: { id: task.id, done: !task.doneAt } })
      .then((result) => {
        if (result.ok) {
          setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, doneAt: result.doneAt, doneBy: result.doneBy } : item)))
          onChanged()
        }
      })
      .finally(() => setBusy(''))
  }

  const columns = [
    taskColumns.accessor('typeLabel', {
      header: 'Задача',
      cell: (info) => (
        <div className="grid gap-1">
          <Badge tone={info.row.original.type === 'remove_person' ? undefined : 'bg-[#1f4d7a] text-white'}>{info.getValue()}</Badge>
          {!info.row.original.active ? <span className="text-xs text-[#5c5160]">Причината отпадна</span> : null}
          {info.row.original.fixStage ? (
            <span className="rounded-full bg-[#fff3c4] px-2 py-0.5 text-xs font-bold text-[#5a4300]" data-testid="rik-task-fix-stage">
              {info.row.original.fixStage}
            </span>
          ) : null}
        </div>
      ),
    }),
    taskColumns.accessor('personName', {
      header: 'Човек',
      cell: (info) =>
        info.row.original.personId && !info.row.original.isPartner ? (
          <Link to="/admin/signups/$personId" params={{ personId: info.row.original.personId }} className="font-bold text-[#2b062f] underline">
            {info.getValue() || '—'}
          </Link>
        ) : (
          <span className="font-bold">{info.getValue() || (info.row.original.personId ? '—' : `РИК ${info.row.original.mir}`)}</span>
        ),
    }),
    taskColumns.accessor('mir', { header: 'МИР', cell: (info) => info.getValue() }),
    taskColumns.accessor('detail', {
      header: 'Какво',
      cell: (info) => (
        <div className="grid gap-1">
          <p className="max-w-xl whitespace-pre-wrap">{info.getValue()}</p>
          {fixing === info.row.original.id && info.row.original.personId ? (
            <IdentityFixForm
              personId={info.row.original.personId}
              taskId={info.row.original.id}
              onCancel={() => setFixing('')}
              onSaved={(_info, message) => {
                setFixing('')
                setFixNote(message)
                onChanged()
              }}
            />
          ) : canFix && info.row.original.personId && info.row.original.personNumber != null && !info.row.original.doneAt ? (
            <button type="button" className={`${adminGhost} justify-self-start`} onClick={() => setFixing(info.row.original.id)}>
              Поправи име/ЕГН
            </button>
          ) : null}
          {info.row.original.type === 'call_rik' || info.row.original.type === 'check_rik' ? (
            <span className="text-xs">Телефон на РИК: {info.row.original.phones || '—'}</span>
          ) : null}
          <span className="flex flex-wrap gap-3 text-xs">
            {info.row.original.sourceUrl ? (
              <a className="underline" href={info.row.original.sourceUrl} target="_blank" rel="noreferrer">
                Източник
              </a>
            ) : null}
            {info.row.original.registerUrl ? (
              <a className="underline" href={info.row.original.registerUrl} target="_blank" rel="noreferrer">
                Регистър на РИК
              </a>
            ) : null}
          </span>
        </div>
      ),
    }),
    taskColumns.display({
      id: 'done',
      header: 'Готово',
      cell: ({ row }) => (
        <div className="grid gap-1 text-xs">
          {row.original.doneAt ? <span>{when(row.original.doneAt)} · {row.original.doneBy}</span> : null}
          {canEdit ? (
            <button type="button" className={adminGhost} disabled={busy === row.original.id} onClick={() => toggle(row.original)}>
              {row.original.doneAt ? 'Върни' : 'Готово'}
            </button>
          ) : null}
        </div>
      ),
    }),
  ]

  return (
    <section className="grid gap-3" aria-label="Задачи">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Кои задачи">
        {(
          [
            ['open', 'Отворени'],
            ['done', 'Готови'],
            ['all', 'Всички'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={search.show === id ? adminChipOn : adminGhost} aria-pressed={search.show === id} onClick={() => setSearch({ show: id })}>
            {label}
          </button>
        ))}
      </div>
      <label className="grid max-w-xs gap-1 text-sm font-bold" htmlFor="rik-type">
        Вид
        <select id="rik-type" className={adminInput} value={search.type} onChange={(event) => setSearch({ type: event.target.value })}>
          <option value="">Всички</option>
          {(Object.keys(TASK_LABELS) as RikTaskType[]).map((type) => (
            <option key={type} value={type}>
              {TASK_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      {fixNote ? (
        <p className="text-sm font-bold text-[#1d5f2f]" role="status" data-testid="identity-fix-note">
          {fixNote}
        </p>
      ) : null}
      <p className="text-sm font-bold" role="status">
        {phase === 'loading' ? 'Зареждаме…' : phase === 'error' ? 'Задачите не се заредиха.' : `${total} задачи.`}
      </p>
      <DataTable data={tasks} columns={columns} rowId={(row) => row.id} />
      <Pager page={search.page} total={total} onPage={(page) => setSearch({ page })} />
    </section>
  )
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / 50))
  if (pages <= 1) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={adminGhost} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Предишна
      </button>
      <span className="text-sm font-bold">
        Страница {page} от {pages}
      </span>
      <button type="button" className={adminGhost} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Следваща
      </button>
    </div>
  )
}

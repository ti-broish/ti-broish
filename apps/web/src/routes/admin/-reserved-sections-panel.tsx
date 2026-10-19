import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { adminGhost, adminInput } from '../../components/admin-ui'
import {
  adminReservedCommit,
  adminReservedPreview,
  adminReservedRemove,
  type ReservedPreview,
} from '../../signup/reserved-sections-admin'
import { cleanOrg, type ReservationConflict } from '../../signup/reserved-sections'
import { ReservedBadge } from './-reserved-badge'

export type ReservedRowView = { sectionCode: string; organisation: string; note: string; place: string }

export function ReservedSectionsPanel(props: {
  canEdit: boolean
  rows: ReservedRowView[]
  orgs: Array<{ organisation: string; count: number }>
  conflicts: ReservationConflict[]
  setMessage: (message: string) => void
  reload: (notice?: string) => void
}) {
  const { canEdit, rows, orgs, conflicts, setMessage, reload } = props
  const [org, setOrg] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ReservedPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const [armedOrg, setArmedOrg] = useState('')
  const shown = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase('bg')
    return rows.filter((row) => !needle || row.sectionCode.includes(needle) || row.organisation.toLocaleLowerCase('bg').includes(needle))
  }, [rows, filter])

  const stale = Boolean(preview && cleanOrg(org) !== preview.organisation)

  function runPreview(text = csv, nextOrg = org, nextMode = mode) {
    if (!text) return
    setBusy(true)
    void adminReservedPreview({ data: { csv: text, org: nextOrg, mode: nextMode } })
      .then((result) => {
        setBusy(false)
        if (!result.ok) {
          setMessage(result.message)
          return
        }
        setPreview(result.plan)
        setMessage(result.message)
      })
      .catch(() => {
        setBusy(false)
        setMessage('Прегледът не се зареди.')
      })
  }

  function remove(input: { codes?: string[]; org?: string }) {
    void adminReservedRemove({ data: input }).then((result) => {
      setArmedOrg('')
      if (!result.ok) setMessage(result.message)
      else reload(result.message)
    })
  }

  return (
    <details className="grid gap-3 rounded-2xl border-2 border-[#5a1a1a] bg-white p-4" data-testid="reserved-panel">
      <summary className="cursor-pointer text-lg font-black text-[#1a1020]">
        Резервирани секции от други организации — {rows.length}
        {conflicts.length ? ` · конфликти ${conflicts.length}` : ''}
      </summary>
      <div className="mt-3 grid gap-4">
        <p className="text-sm text-[#333]">
          Тук не записваме наши хора: черновата, „Предложи“, „Направи чернови“ и публикуването ги отказват.
          Хората, които вече са на такава секция, не се махат сами. Виж „Конфликти“ и ги пренасочи.
        </p>
        {canEdit ? (
          <div className="grid gap-3 rounded-xl border border-[#d8c9dc] p-3">
            <p className="text-sm text-[#333]">
              CSV с <b>СИК</b> (9 цифри) и <b>организация</b>, по желание <b>бележка</b>. Разделител „;“ или „,“; заглавният ред е по желание.
              Ако файлът е само с кодове, напиши организацията тук.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm font-bold text-[#1a1020]">
                Организация
                <input
                  className={`${adminInput} w-64`}
                  value={org}
                  placeholder="за файл само с кодове"
                  aria-label="Организация за резервациите"
                  onChange={(event) => setOrg(event.target.value)}
                />
              </label>
              <fieldset className="grid gap-1 text-sm text-[#1a1020]">
                <legend className="font-bold">Как</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="reserve-mode" checked={mode === 'merge'} onChange={() => { setMode('merge'); runPreview(csv, org, 'merge') }} />
                  Добави и обнови
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="reserve-mode" checked={mode === 'replace'} onChange={() => { setMode('replace'); runPreview(csv, org, 'replace') }} />
                  Замени целия списък на организацията
                </label>
              </fieldset>
              <label className="grid gap-1 text-sm font-bold text-[#1a1020]">
                Файл
                <input
                  className={adminInput}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  aria-label="CSV с резервирани секции"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (!file) return
                    setFileName(file.name)
                    void file.text().then((text) => {
                      setCsv(text)
                      runPreview(text)
                    })
                  }}
                />
              </label>
            </div>
            {preview ? <PreviewBox preview={preview} fileName={fileName} /> : null}
            {preview && stale ? (
              <p className="text-sm font-bold text-[#8f1d1d]">Организацията във формата е сменена. Натисни „Прегледай пак“ преди запис.</p>
            ) : null}
            {preview ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="brand-button w-auto px-6"
                  disabled={busy || stale || preview.errors.length > 0 || (preview.valid === 0 && preview.removeCount === 0)}
                  onClick={() => {
                    setBusy(true)
                    void adminReservedCommit({ data: { csv, org, mode } }).then((result) => {
                      setBusy(false)
                      if (!result.ok) {
                        setMessage(result.message)
                        return
                      }
                      setPreview(null)
                      setCsv('')
                      setFileName('')
                      reload(result.message)
                    }).catch(() => {
                      setBusy(false)
                      setMessage('Резервациите не се записаха. Опитай пак.')
                    })
                  }}
                >
                  {busy ? 'Записваме…' : 'Запиши резервациите'}
                </button>
                <button type="button" className={adminGhost} disabled={busy} onClick={() => runPreview()}>
                  Прегледай пак
                </button>
                <button type="button" className={adminGhost} onClick={() => { setPreview(null); setCsv(''); setFileName('') }}>
                  Откажи
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <section className="grid gap-2">
          <h3 className="text-base font-black text-[#1a1020]">Конфликти: наши хора на резервирани секции ({conflicts.length})</h3>
          {conflicts.length === 0 ? (
            <p className="text-sm text-[#333]">Няма.</p>
          ) : (
            <ConflictTable conflicts={conflicts} />
          )}
        </section>

        <section className="grid gap-2">
          <h3 className="text-base font-black text-[#1a1020]">Организации</h3>
          {orgs.length === 0 ? <p className="text-sm text-[#333]">Няма резервирани секции.</p> : null}
          <ul className="flex flex-wrap gap-2">
            {orgs.map((item) => (
              <li key={item.organisation} className="flex items-center gap-2 rounded-full border border-[#2b062f] px-3 py-1 text-sm">
                <b>{item.organisation}</b> {item.count}
                {canEdit ? (
                  <button
                    type="button"
                    className="text-xs font-bold text-[#8f1d1d] underline"
                    onClick={() => (armedOrg === item.organisation ? remove({ org: item.organisation }) : setArmedOrg(item.organisation))}
                  >
                    {armedOrg === item.organisation ? `Да, махни всички ${item.count}` : 'Махни всички'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {rows.length > 0 ? (
          <section className="grid gap-2">
            <label className="grid max-w-sm gap-1 text-sm font-bold text-[#1a1020]">
              Търси секция или организация
              <input className={adminInput} value={filter} onChange={(event) => setFilter(event.target.value)} />
            </label>
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm text-[#1a1020]">
                <thead>
                  <tr className="border-b-2 border-[#2b062f]">
                    <th className="px-2 py-2">Секция</th>
                    <th className="px-2 py-2">Резервирана от</th>
                    <th className="px-2 py-2">Бележка</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 500).map((row) => (
                    <tr key={row.sectionCode} className="border-b border-[#eee]">
                      <td className="px-2 py-2 font-mono text-xs">{row.sectionCode}</td>
                      <td className="px-2 py-2"><ReservedBadge org={row.organisation} /></td>
                      <td className="px-2 py-2">{[row.note, row.place].filter(Boolean).join(' · ')}</td>
                      <td className="px-2 py-2">
                        {canEdit ? (
                          <button type="button" className="text-xs font-bold underline" onClick={() => remove({ codes: [row.sectionCode] })}>
                            Махни
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[#333]">Показани {Math.min(shown.length, 500)} от {shown.length}.</p>
          </section>
        ) : null}
      </div>
    </details>
  )
}

function PreviewBox({ preview, fileName }: { preview: ReservedPreview; fileName: string }) {
  return (
    <div className="grid gap-2 rounded-xl bg-[#f6f1f7] p-3 text-sm text-[#1a1020]" data-testid="reserved-preview">
      <p className="font-black">
        Преглед{fileName ? ` на ${fileName}` : ''} (нищо не е записано){preview.mode === 'replace' ? ` · замяна за ${preview.organisation}` : ''}
      </p>
      {preview.errors.map((error) => (
        <p key={error} role="alert" className="font-bold text-[#8f1d1d]">{error}</p>
      ))}
      <p>
        Валидни {preview.valid}: нови {preview.add}, обновени {preview.update}, без промяна {preview.unchanged}
        {preview.movedCount ? `, от друга организация ${preview.movedCount}` : ''}
        {preview.removeCount ? ` · махаме ${preview.removeCount}` : ''}
        {preview.orgs.length ? ` · организации: ${preview.orgs.join(', ')}` : ''}
      </p>
      {preview.invalidCount ? (
        <p>Невалидни редове {preview.invalidCount}: {preview.invalid.map((row) => `ред ${row.line} „${row.value}“ — ${row.reason}`).join('; ')}</p>
      ) : null}
      {preview.duplicateCount ? (
        <p>Повторени {preview.duplicateCount} (пазим първия ред): {preview.duplicates.map((row) => `${row.sectionCode} (редове ${row.lines.join(', ')})`).join('; ')}</p>
      ) : null}
      {preview.unknownCount ? (
        <p>Непознати кодове {preview.unknownCount} (не са в списъка на ЦИК или МВнР; ще се запишат, за да не ги дадем по грешка): {preview.unknown.join(', ')}</p>
      ) : null}
      {preview.movedCount ? (
        <p>Сменят организацията: {preview.moved.map((row) => `${row.sectionCode} ${row.from} → ${row.to}`).join('; ')}</p>
      ) : null}
      {preview.removeCount ? <p>Махаме резервацията на: {preview.remove.join(', ')}</p> : null}
      <p className={preview.conflictCount ? 'font-bold text-[#8f1d1d]' : ''}>
        Наши хора на тези секции: {preview.conflictCount}. Няма да ги махнем сами.
      </p>
      {preview.conflictCount ? <ConflictTable conflicts={preview.conflicts} /> : null}
    </div>
  )
}

function ConflictTable({ conflicts }: { conflicts: ReservationConflict[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm text-[#1a1020]" data-testid="reserved-conflicts">
        <thead>
          <tr className="border-b-2 border-[#2b062f]">
            <th className="px-2 py-2">Секция</th>
            <th className="px-2 py-2">Резервирана от</th>
            <th className="px-2 py-2">Наш човек</th>
            <th className="px-2 py-2">Как</th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map((item) => (
            <tr key={`${item.sectionCode}-${item.personId}-${item.kind}`} className="border-b border-[#eee]">
              <td className="px-2 py-2 font-mono text-xs">{item.sectionCode}</td>
              <td className="px-2 py-2"><ReservedBadge org={item.organisation} conflict /></td>
              <td className="px-2 py-2">
                <Link to="/admin/signups/$personId" params={{ personId: item.personId }} className="font-bold text-[#2b062f] underline">
                  {item.name || item.email}
                </Link>
                <span className="block text-xs">{item.email}</span>
              </td>
              <td className="px-2 py-2">{item.kind === 'published' ? 'Публикувана' : 'Чернова'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

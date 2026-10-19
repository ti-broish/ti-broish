import { useMemo, useState } from 'react'
import { adminGhost, adminInput } from '../../components/admin-ui'
import { adminImportPrioritySections, type PrioritySectionView } from '../../signup/priority-sections-admin'
import { levelRank, priorityLevelLabel, type PriorityCoverage, type PriorityCoverageState } from '../../signup/priority-sections'
import { PriorityBadge } from './-priority-badge'
import { ReservedBadge } from './-reserved-badge'

const STATE_LABEL: Record<PriorityCoverageState, string> = {
  published: 'Публикувана',
  draft: 'Чернова',
  taken: 'Резервирана',
  open: 'Без човек',
}

export function PriorityCoverageLine({ summary }: { summary: PriorityCoverage | null }) {
  if (!summary || summary.total === 0) return null
  return (
    <p className="text-sm font-bold text-[#1a1020]" data-testid="priority-coverage">
      Приоритетни секции: покрити {summary.covered} от {summary.total} (публикувани {summary.published}, чернови {summary.draft})
      {summary.taken ? ` · резервирани от други ${summary.taken}` : ''} · без човек {summary.uncovered}
      {summary.byLevel.length > 0 ? ` · ${summary.byLevel.map((item) => `${priorityLevelLabel(item.level)} ${item.covered}/${item.total}`).join(' · ')}` : ''}
    </p>
  )
}

export function PrioritySectionsPanel(props: {
  canEdit: boolean
  sections: PrioritySectionView[]
  summary: PriorityCoverage | null
  updatedAt: string
  setMessage: (message: string) => void
  reload: (notice?: string) => void
}) {
  const { canEdit, sections, summary, updatedAt, setMessage, reload } = props
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [level, setLevel] = useState('')
  const [busy, setBusy] = useState(false)
  const levels = useMemo(
    () => [...new Set(sections.map((row) => row.level))].sort((a, b) => levelRank(a) - levelRank(b) || a.localeCompare(b)),
    [sections],
  )
  const shown = sections.filter((row) => (!onlyOpen || row.state === 'open') && (!level || row.level === level))
  return (
    <details className="grid gap-3 rounded-2xl border-2 border-[#2b062f] bg-white p-4" data-testid="priority-panel">
      <summary className="cursor-pointer text-lg font-black text-[#1a1020]">
        Приоритетни секции{summary ? ` — покрити ${summary.covered}/${summary.total}` : ''}
      </summary>
      <div className="mt-3 grid gap-3">
        <PriorityCoverageLine summary={summary} />
        <p className="text-sm text-[#333]">
          Списък с риск R по секция. „Предложи“ показва първо тези секции в града и общината на човека. Нищо тук не прави чернови,
          не публикува и не праща имейли.{updatedAt ? ` Качен: ${new Date(updatedAt).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })}.` : ''}
        </p>
        {canEdit ? (
          <label className="grid gap-1 text-sm font-bold text-[#1a1020]">
            Качи нов CSV (СИК;…;R;level;…). Замества целия списък.
            <input
              className={`${adminInput} w-full`}
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              aria-label="CSV с приоритетни секции"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                setBusy(true)
                void file
                  .text()
                  .then((csv) => adminImportPrioritySections({ data: { csv } }))
                  .then((result) => {
                    setBusy(false)
                    if (!result.ok) setMessage(result.message)
                    else reload(result.message)
                  })
                  .catch(() => {
                    setBusy(false)
                    setMessage('Файлът не се качи. Опитай пак.')
                  })
              }}
            />
          </label>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm font-bold text-[#1a1020]">
            <input type="checkbox" checked={onlyOpen} onChange={(event) => setOnlyOpen(event.target.checked)} />
            Само без човек
          </label>
          <label className="grid gap-1 text-sm font-bold text-[#1a1020]">
            Ниво
            <select className={adminInput} value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">Всички</option>
              {levels.map((item) => (
                <option key={item} value={item}>{priorityLevelLabel(item)}</option>
              ))}
            </select>
          </label>
          <button type="button" className={adminGhost} onClick={() => reload()}>
            Обнови
          </button>
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-[#333]">{sections.length === 0 ? 'Няма качен списък с приоритетни секции.' : 'Няма секции за този филтър.'}</p>
        ) : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[800px] border-collapse text-left text-sm text-[#1a1020]">
              <thead>
                <tr className="border-b-2 border-[#2b062f]">
                  <th className="px-2 py-2">Секция</th>
                  <th className="px-2 py-2">Приоритет</th>
                  <th className="px-2 py-2">Населено място</th>
                  <th className="px-2 py-2">Община</th>
                  <th className="px-2 py-2">Област</th>
                  <th className="px-2 py-2">Покритие</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.sectionCode} className="border-b border-[#eee]">
                    <td className="px-2 py-2 font-mono text-xs">{row.sectionCode}</td>
                    <td className="px-2 py-2"><PriorityBadge info={row} /></td>
                    <td className="px-2 py-2">{row.town}</td>
                    <td className="px-2 py-2">{row.municipality}</td>
                    <td className="px-2 py-2">{row.oblast}</td>
                    <td className={`px-2 py-2 font-bold ${row.state === 'open' ? 'text-[#8f1d1d]' : ''}`}>
                      {row.state === 'taken' ? null : STATE_LABEL[row.state]}
                      {row.reservedBy ? <> <ReservedBadge org={row.reservedBy} conflict={row.state === 'published' || row.state === 'draft'} /></> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-[#333]">Показани {shown.length} от {sections.length}. Подредени: първо без човек, после по R.</p>
      </div>
    </details>
  )
}
